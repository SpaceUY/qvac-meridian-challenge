import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSessionCache,
  EngineError,
  parseCitations,
  parseCitedChunks,
  parseTools,
  readDeltas,
  type ChatDelta,
} from '@/lib/chat-client'

/** A body shaped like the backend's stream: strict chat.completion.chunk events, then [DONE]. */
function sseBody(deltas: object[]): ReadableStream<Uint8Array> {
  const envelope = { id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'meridian-assistant' }
  const events = deltas.map(
    (delta) => `data: ${JSON.stringify({ ...envelope, choices: [{ index: 0, delta, logprobs: null, finish_reason: null }] })}\n\n`,
  )
  const bytes = new TextEncoder().encode(events.join('') + 'data: [DONE]\n\n')
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

describe('readDeltas', () => {
  it('reads the text, tools, and final citations chunk, skipping the role-only chunk', async () => {
    const citations = [{ file: 'reports/q2.md', score: 0.83 }]
    const tools = ['lookup_stock']
    const deltas: ChatDelta[] = []
    for await (const delta of readDeltas(
      sseBody([{ role: 'assistant', content: '' }, { content: 'Hi' }, { tools }, { citations }, {}]),
    )) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([
      { text: 'Hi', tools: undefined, citations: undefined },
      { text: undefined, tools, citations: undefined },
      { text: undefined, tools: undefined, citations },
    ])
  })

  it('reads the cited chunks delta, which carries nothing else', async () => {
    const citedChunks = [{ file: 'reports/q2.md', chunkIndex: 3, score: 0.83, content: 'Q2 revenue was $18.4M.' }]
    const deltas: ChatDelta[] = []
    for await (const delta of readDeltas(sseBody([{ citedChunks }]))) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ text: undefined, tools: undefined, citations: undefined, citedChunks }])
  })
})

describe('parseCitedChunks', () => {
  it('keeps well-formed chunks, with or without a chunkIndex, and drops the rest', () => {
    const raw = [
      { file: 'a.md', chunkIndex: 2, score: 0.5, content: 'first' },
      { file: 'b.md', score: 0.4, content: 'no index' },
      { file: 'c.md', chunkIndex: 1, score: 0.3 },
      { file: 'd.md', chunkIndex: 1, score: 'high', content: 'bad score' },
      { file: 7, score: 0.2, content: 'bad file' },
      { file: 'e.md', chunkIndex: '1', score: 0.1, content: 'bad index' },
    ]
    expect(parseCitedChunks(raw)).toEqual([
      { file: 'a.md', chunkIndex: 2, score: 0.5, content: 'first' },
      { file: 'b.md', score: 0.4, content: 'no index' },
    ])
  })

  it('returns an empty array for anything that is not an array', () => {
    expect(parseCitedChunks(undefined)).toEqual([])
    expect(parseCitedChunks({ file: 'a.md' })).toEqual([])
  })
})

describe('parseTools', () => {
  it('keeps only string entries', () => {
    expect(parseTools(['lookup_stock', 42, 'list_documents', null])).toEqual(['lookup_stock', 'list_documents'])
  })

  it('returns an empty array for anything that is not an array', () => {
    expect(parseTools(undefined)).toEqual([])
    expect(parseTools('lookup_stock')).toEqual([])
  })
})

describe('parseCitations', () => {
  it('keeps well-formed entries and drops the rest', () => {
    const raw = [{ file: 'a.md', score: 0.5 }, { file: 1 }, { file: 'b.md', score: 'high' }, { file: 'c.md' }]
    expect(parseCitations(raw)).toEqual([{ file: 'a.md', score: 0.5 }, { file: 'c.md' }])
  })

  it('returns an empty array for anything that is not an array', () => {
    expect(parseCitations(undefined)).toEqual([])
    expect(parseCitations({ file: 'a.md' })).toEqual([])
  })
})

describe('deleteSessionCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends a DELETE for the KV cache of the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await deleteSessionCache('3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b')

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/sessions/3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b/cache', {
      method: 'DELETE',
    })
  })

  it('rejects with the server status when the backend refuses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"nope"}', { status: 500 })))

    await expect(deleteSessionCache('session-1')).rejects.toBeInstanceOf(EngineError)
  })
})
