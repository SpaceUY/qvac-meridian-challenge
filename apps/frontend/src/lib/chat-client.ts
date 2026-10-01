// ---------------------------------------------------------------------------
// THE TRANSPORT LAYER
//
// This is the only part of the frontend that knows HTTP and knows the OpenAI format.
// It does not know React exists. It does not know what a conversation turn is. Its
// job is: to request, and to translate what comes back into something the rest understands.
//

import type { Citation, Message } from '@/lib/chat-types'
import { CONFIG } from '@/lib/config'
import { readSSEEvents } from '@/lib/parse-sse'
import { readFileAsDataUrl } from '@/lib/image-attachments'
import { isObject } from '@/lib/utils'

/** OpenAI Vision-style content part - the same shape the backend's chat.router.helpers.ts parses. */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

/** The "wire" format: how messages travel over the network (OpenAI style). `content` stays a plain string for text-only turns (unchanged wire shape); only a turn with images gets the content-parts array. */
export type OpenAIMessage = { role: 'user' | 'assistant'; content: string | ContentPart[] }
export type ChatDelta = { text?: string; citations?: Citation[] }

/**
 * Async because building an image turn's wire content means reading each
 * attached File into a base64 data URL - deliberately deferred to exactly
 * this point (see image-attachments.ts) rather than done once and cached,
 * so a long conversation with several attached images never holds more
 * than one turn's worth of base64 in memory at a time.
 */
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

/** The backend's own `{ error: "..." }` body (chat.router.ts's 400s carry a specific, human-readable reason - e.g. "Only JPEG or PNG images are supported") - falls back to the generic status-code message only if the body isn't that shape. Exported: voice-client.ts's requestVoiceCompletion hits the same backend error shape on its own 400s. */
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
  const citations = parseCitations(delta.citations)

  if (text === undefined && citations.length === 0) return null

  return { text, citations: citations.length > 0 ? citations : undefined }
}

function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** Keeps only well-formed citations. Exported for voice-client.ts: the voice endpoint carries the same array. */
export function parseCitations(value: unknown): Citation[] {
  return Array.isArray(value) ? value.filter(isCitation) : []
}

function isCitation(v: unknown): v is Citation {
  return isObject(v) && typeof v.file === 'string' && (v.score === undefined || typeof v.score === 'number')
}
