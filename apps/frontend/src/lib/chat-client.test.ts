import { describe, expect, it } from 'vitest'
import { parseCitations, readDeltas, type ChatDelta } from '@/lib/chat-client'

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
  it('reads the text and the final citations chunk, skipping the role-only chunk', async () => {
    const citations = [{ file: 'reports/q2.md', score: 0.83 }]
    const deltas: ChatDelta[] = []
    for await (const delta of readDeltas(sseBody([{ role: 'assistant', content: '' }, { content: 'Hi' }, { citations }, {}]))) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ text: 'Hi', citations: undefined }, { text: undefined, citations }])
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
