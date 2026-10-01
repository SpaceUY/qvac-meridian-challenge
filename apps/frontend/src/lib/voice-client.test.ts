import { afterEach, describe, expect, it, vi } from 'vitest'
import { readVoiceDeltas, requestVoiceCompletion, type VoiceDelta } from '@/lib/voice-client'
import { EngineError } from '@/lib/chat-client'

const REQUEST = { messages: [], audioBase64: 'AAAA', signal: new AbortController().signal }

afterEach(() => vi.unstubAllGlobals())

/** A body shaped like the backend's voice-completions SSE stream: `toVoiceAudioChunk`/`toVoiceDoneChunk`/`toVoiceErrorChunk` events, then [DONE]. */
function sseBody(events: object[]): ReadableStream<Uint8Array> {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n'
  const bytes = new TextEncoder().encode(text)
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('requestVoiceCompletion', () => {
  it('sends stream:true alongside the messages and audio', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(sseBody([])))
    vi.stubGlobal('fetch', fetchMock)

    await requestVoiceCompletion(REQUEST)

    const init = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(init?.body as string)).toMatchObject({ stream: true, audioBase64: 'AAAA' })
  })

  it('throws EngineError when the response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'boom' }, { status: 500 })))

    await expect(requestVoiceCompletion(REQUEST)).rejects.toThrow(EngineError)
  })
})

describe('readVoiceDeltas', () => {
  it('yields an audio delta with a data URL built from audioBase64', async () => {
    const deltas: VoiceDelta[] = []
    for await (const delta of readVoiceDeltas(
      sseBody([{ type: 'audio', text: 'Hi.', audioBase64: 'AAAA', sampleRate: 16000 }]),
    )) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ type: 'audio', text: 'Hi.', audioDataUrl: 'data:audio/wav;base64,AAAA', sampleRate: 16000 }])
  })

  it('yields an audio delta with no audioDataUrl when that chunk had no synthesized audio', async () => {
    const deltas: VoiceDelta[] = []
    for await (const delta of readVoiceDeltas(sseBody([{ type: 'audio', text: 'Hi.' }]))) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ type: 'audio', text: 'Hi.', audioDataUrl: undefined, sampleRate: undefined }])
  })

  it('yields a done delta with the transcript and well-formed citations', async () => {
    const citations = [{ file: 'policies/warranty-terms.md', score: 0.77 }]
    const deltas: VoiceDelta[] = []
    for await (const delta of readVoiceDeltas(sseBody([{ type: 'done', transcript: 'warranty?', citations }]))) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ type: 'done', transcript: 'warranty?', tools: [], citations }])
  })

  it('yields a done delta with the tools the agent used', async () => {
    const deltas: VoiceDelta[] = []
    for await (const delta of readVoiceDeltas(
      sseBody([{ type: 'done', transcript: 'how many in stock?', tools: ['lookup_stock'], citations: [] }]),
    )) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ type: 'done', transcript: 'how many in stock?', tools: ['lookup_stock'], citations: [] }])
  })

  it('yields an error delta', async () => {
    const deltas: VoiceDelta[] = []
    for await (const delta of readVoiceDeltas(sseBody([{ type: 'error', error: 'no speech detected in audio' }]))) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ type: 'error', error: 'no speech detected in audio' }])
  })

  it('skips events with an unrecognized or missing type', async () => {
    const deltas: VoiceDelta[] = []
    for await (const delta of readVoiceDeltas(
      sseBody([{ foo: 'bar' }, { type: 'done', transcript: 'hi', citations: [] }]),
    )) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ type: 'done', transcript: 'hi', tools: [], citations: [] }])
  })
})
