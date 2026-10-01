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

/** The "wire" format: how messages travel over the network (OpenAI style). */
export type OpenAIMessage = { role: 'user' | 'assistant'; content: string }
export type ChatDelta = { text?: string; citations?: Citation[] }

export function toOpenAIMessages(messages: Pick<Message, 'role' | 'text'>[]): OpenAIMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.text }))
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

  if (!res.ok) throw new EngineError(`the server responded ${res.status}`, res.status)
  if (!res.body) throw new EngineError('the server responded with no body')

  return res.body
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

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/** Keeps only well-formed citations. Exported for voice-client.ts: the voice endpoint carries the same array. */
export function parseCitations(value: unknown): Citation[] {
  return Array.isArray(value) ? value.filter(isCitation) : []
}

function isCitation(v: unknown): v is Citation {
  return isObject(v) && typeof v.file === 'string' && (v.score === undefined || typeof v.score === 'number')
}
