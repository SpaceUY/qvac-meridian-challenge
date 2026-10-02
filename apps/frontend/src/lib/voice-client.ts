// apps/frontend/src/lib/voice-client.ts
//
// Transport for a voice turn - the sibling of chat-client.ts but for
// /v1/chat/voice-completions: one complete audio in, a stream of SSE events
// out (one per synthesized sentence, then a final transcript+citations
// event) - same opt-in `stream: true` convention chat-client.ts's
// requestCompletion already uses for text. Only knows HTTP and the wire
// shape; doesn't know what a microphone or the store are.

import type { OpenAIMessage } from '@/lib/chat-client'
import { EngineError, readErrorMessage, parseCitations, parseCitedChunks, parseTools } from '@/lib/chat-client'
import type { Citation, CitedChunk } from '@/lib/chat-types'
import { readSSEEvents } from '@/lib/parse-sse'
import { isObject } from '@/lib/utils'

const VOICE_COMPLETIONS_ENDPOINT = '/v1/chat/voice-completions'

export type VoiceDelta =
  | { type: 'audio'; text: string; audioDataUrl?: string; sampleRate?: number }
  | { type: 'done'; transcript: string; tools: string[]; citations: Citation[]; citedChunks: CitedChunk[] }
  | { type: 'error'; error: string }

type VoiceCompletionRequest = {
  messages: OpenAIMessage[]
  audioBase64: string
  signal: AbortSignal
}

export async function requestVoiceCompletion({
  messages,
  audioBase64,
  signal,
}: VoiceCompletionRequest): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(VOICE_COMPLETIONS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, audioBase64, stream: true }),
    signal,
  })

  if (!res.ok) throw new EngineError(await readErrorMessage(res), res.status)
  if (!res.body) throw new EngineError('the server responded with no body')

  return res.body
}

export async function* readVoiceDeltas(body: ReadableStream<Uint8Array>): AsyncGenerator<VoiceDelta> {
  for await (const json of readSSEEvents(body)) {
    const delta = parseVoiceEvent(json)
    if (delta !== null) yield delta
  }
}

function parseVoiceEvent(json: string): VoiceDelta | null {
  const event = safeJsonParse(json)
  if (!isObject(event)) return null

  if (event.type === 'audio' && typeof event.text === 'string') {
    return {
      type: 'audio',
      text: event.text,
      audioDataUrl: typeof event.audioBase64 === 'string' ? `data:audio/wav;base64,${event.audioBase64}` : undefined,
      sampleRate: typeof event.sampleRate === 'number' ? event.sampleRate : undefined,
    }
  }

  if (event.type === 'done' && typeof event.transcript === 'string') {
    return {
      type: 'done',
      transcript: event.transcript,
      tools: parseTools(event.tools),
      citations: parseCitations(event.citations),
      citedChunks: parseCitedChunks(event.citedChunks),
    }
  }

  if (event.type === 'error' && typeof event.error === 'string') {
    return { type: 'error', error: event.error }
  }

  return null
}

function safeJsonParse(json: string): unknown {
  try {
    return JSON.parse(json)
  } catch {
    return null
  }
}
