// apps/frontend/src/lib/voice-client.ts
//
// Transport for a voice turn - the sibling of chat-client.ts but for
// /v1/chat/voice-completions: one complete audio in, one complete JSON out
// (never SSE - the client needs the finished WAV, not incremental text).
// Only knows HTTP and the wire shape; doesn't know what a microphone or the
// store are.

import type { OpenAIMessage } from '@/lib/chat-client'
import { EngineError, readErrorMessage, parseCitations } from '@/lib/chat-client'
import type { Citation } from '@/lib/chat-types'

const VOICE_COMPLETIONS_ENDPOINT = '/v1/chat/voice-completions'

export type VoiceCompletionResult = {
  transcript: string
  answer: string
  /** Same shape and meaning as the text endpoint's citations. Empty when the answer wasn't grounded. */
  citations: Citation[]
  /** `data:audio/wav;base64,...` ready for an <audio src>. Absent if TTS synthesis failed server-side - the turn is still valid. */
  audioDataUrl?: string
}

type VoiceCompletionRequest = {
  messages: OpenAIMessage[]
  audioBase64: string
  signal: AbortSignal
}

export async function requestVoiceCompletion({
  messages,
  audioBase64,
  signal,
}: VoiceCompletionRequest): Promise<VoiceCompletionResult> {
  const res = await fetch(VOICE_COMPLETIONS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, audioBase64 }),
    signal,
  })

  if (!res.ok) throw new EngineError(await readErrorMessage(res), res.status)

  const body: unknown = await res.json()
  return parseVoiceCompletionBody(body)
}

function parseVoiceCompletionBody(body: unknown): VoiceCompletionResult {
  if (!isObject(body) || typeof body.transcript !== 'string' || typeof body.answer !== 'string') {
    throw new EngineError('the server responded with an unexpected shape')
  }
  const audioDataUrl = typeof body.audioBase64 === 'string' ? `data:audio/wav;base64,${body.audioBase64}` : undefined
  return { transcript: body.transcript, answer: body.answer, citations: parseCitations(body.citations), audioDataUrl }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}
