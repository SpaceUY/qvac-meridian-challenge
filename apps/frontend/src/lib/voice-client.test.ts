import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestVoiceCompletion } from '@/lib/voice-client'

const REQUEST = { messages: [], audioBase64: 'AAAA', signal: new AbortController().signal }

afterEach(() => vi.unstubAllGlobals())

describe('requestVoiceCompletion', () => {
  it('returns the citations the voice endpoint sends', async () => {
    const citations = [{ file: 'policies/warranty-terms.md', score: 0.77 }]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ transcript: 'warranty?', answer: '24 months.', citations })))

    expect((await requestVoiceCompletion(REQUEST)).citations).toEqual(citations)
  })

  it('treats a missing citations field as none', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ transcript: 'hi', answer: 'hello' })))

    expect((await requestVoiceCompletion(REQUEST)).citations).toEqual([])
  })
})
