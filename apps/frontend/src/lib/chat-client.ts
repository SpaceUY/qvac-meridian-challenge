// Transport layer: the only part of the frontend that knows HTTP/OpenAI wire format.

import type { Citation, ContextUsage, Message } from '@/lib/chat-types'
import { CONFIG } from '@/lib/config'
import { readSSEEvents } from '@/lib/parse-sse'
import { readFileAsDataUrl } from '@/lib/image-attachments'
import { isObject } from '@/lib/utils'

/** OpenAI Vision-style content part - the same shape the backend's chat.router.helpers.ts parses. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** OpenAI wire format. `content` stays a plain string for text-only turns; only a turn with images gets the content-parts array. */
export type OpenAIMessage = { role: 'user' | 'assistant'; content: string | ContentPart[] }
export type ChatDelta = { text?: string; tools?: string[]; citations?: Citation[]; context?: ContextUsage }

/** Reads each attached File into base64 lazily, at send time, so a long conversation never holds more than one turn's worth of image data in memory. */
export async function toOpenAIMessages(messages: Pick<Message, 'role' | 'text' | 'images'>[]): Promise<OpenAIMessage[]> {
  return Promise.all(
    messages.map(async (m): Promise<OpenAIMessage> => {
      if (!m.images?.length) return { role: m.role, content: m.text }

      const imageParts = await Promise.all(
        m.images.map(
          async (image): Promise<ContentPart> => ({
            type: 'image_url',
            image_url: { url: await readFileAsDataUrl(image.file) },
          }),
        ),
      )
      return { role: m.role, content: [{ type: 'text', text: m.text }, ...imageParts] }
    }),
  )
}

export class EngineError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'EngineError'
    this.status = status
  }
}

type CompletionRequest = {
  messages: OpenAIMessage[]
  sessionId: string
  signal: AbortSignal
}

export async function requestCompletion({
  messages,
  sessionId,
  signal,
}: CompletionRequest): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(CONFIG.completionsEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CONFIG.sessionHeader]: sessionId,
    },
    body: JSON.stringify({ model: CONFIG.model, messages: messages, stream: true }),
    signal,
  })

  if (!res.ok) throw new EngineError(await readErrorMessage(res), res.status)
  if (!res.body) throw new EngineError('the server responded with no body')

  return res.body
}

/** Frees the backend's KV cache for a conversation that no longer exists (New chat); a session with no cache is still treated as success. */
export async function deleteSessionCache(sessionId: string): Promise<void> {
  const res = await fetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}/cache`, { method: 'DELETE' })
  if (!res.ok) throw new EngineError(await readErrorMessage(res), res.status)
}

/** Prefers the backend's `{ error: "..." }` body (a human-readable 400 reason) over the generic status-code message. Exported: voice-client.ts reuses it for the same error shape. */
export async function readErrorMessage(res: Response): Promise<string> {
  const body = safeJsonParse(await res.text())
  if (isObject(body) && typeof body.error === 'string' && body.error !== '') return body.error
  return `the server responded ${res.status}`
}

export async function* readDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<ChatDelta> {
  for await (const json of readSSEEvents(body)) {
    const delta = parseChunk(json)
    if (delta !== null) yield delta
  }
}

function parseChunk(json: string): ChatDelta | null {
  const chunk = safeJsonParse(json)
  if (!isObject(chunk)) return null

  const choices = chunk.choices
  const first = Array.isArray(choices) ? choices[0] : undefined
  if (!isObject(first)) return null

  const delta = first.delta
  if (!isObject(delta)) return null

  const text = typeof delta.content === 'string' && delta.content !== '' ? delta.content : undefined
  const tools = parseTools(delta.tools)
  const citations = parseCitations(delta.citations)
  const context = parseContextUsage(delta.context)

  if (text === undefined && tools.length === 0 && citations.length === 0 && context === undefined) return null

  return {
    text,
    tools: tools.length > 0 ? tools : undefined,
    citations: citations.length > 0 ? citations : undefined,
    context,
  }
}

function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** Exported: voice-client.ts's `tools` field has the same shape. */
export function parseTools(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** Exported: voice-client.ts carries the same array. */
export function parseCitations(value: unknown): Citation[] {
  return Array.isArray(value) ? value.filter(isCitation) : []
}

function isCitation(v: unknown): v is Citation {
  return isObject(v) && typeof v.file === 'string' && (v.score === undefined || typeof v.score === 'number')
}

/** Exported: voice-client.ts's done event carries the same object. */
export function parseContextUsage(value: unknown): ContextUsage | undefined {
  if (!isObject(value)) return undefined
  const { usedTokens, maxTokens, exhausted } = value
  return typeof usedTokens === 'number' && typeof maxTokens === 'number' && typeof exhausted === 'boolean'
    ? { usedTokens, maxTokens, exhausted }
    : undefined
}
