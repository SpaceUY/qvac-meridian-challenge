import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  deleteSessionCache,
  EngineError,
  parseCitations,
  parseContextUsage,
  parseTools,
  readDeltas,
  readErrorMessage,
  requestCompletion,
  toOpenAIMessages,
  type ChatDelta,
} from '@/lib/chat-client'
import { CONFIG } from '@/lib/config'

/** No Buffer in the frontend's browser-only tsconfig; this is the same encoding without it. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Node has no FileReader; this mirrors just enough of it (readAsDataURL -> onload) for readFileAsDataUrl. */
class FakeFileReader {
  result: string | null = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  error: Error | null = null

  readAsDataURL(file: File) {
    file
      .arrayBuffer()
      .then((buf) => {
        this.result = `data:${file.type};base64,${bytesToBase64(new Uint8Array(buf))}`
        this.onload?.()
      })
      .catch((error: Error) => {
        this.error = error
        this.onerror?.()
      })
  }
}

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
})

describe('toOpenAIMessages', () => {
  it('keeps a text-only message as a plain string', async () => {
    const result = await toOpenAIMessages([{ role: 'user', text: 'How many SD-X4-001 in stock?' }])
    expect(result).toEqual([{ role: 'user', content: 'How many SD-X4-001 in stock?' }])
  })

  it('turns an image attachment into a content-parts array with a data URL', async () => {
    vi.stubGlobal('FileReader', FakeFileReader)
    const file = new File([new Uint8Array([1, 2, 3])], 'part.png', { type: 'image/png' })

    const result = await toOpenAIMessages([
      { role: 'user', text: "what's wrong with this part?", images: [{ id: '1', file, previewUrl: 'blob:a', mimeType: 'image/png' }] },
    ])

    expect(result).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: "what's wrong with this part?" },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AQID' } },
        ],
      },
    ])
    vi.unstubAllGlobals()
  })
})

describe('requestCompletion', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the messages and returns the response body stream', async () => {
    const body = new ReadableStream()
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const signal = new AbortController().signal

    const result = await requestCompletion({ messages: [{ role: 'user', content: 'hi' }], sessionId: 'sess-1', signal })

    expect(result).toBe(body)
    expect(fetchMock).toHaveBeenCalledWith(
      CONFIG.completionsEndpoint,
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [CONFIG.sessionHeader]: 'sess-1' },
        signal,
      }),
    )
  })

  it('rejects with the backend error message when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"context exhausted"}', { status: 400 })))

    await expect(
      requestCompletion({ messages: [], sessionId: 'sess-1', signal: new AbortController().signal }),
    ).rejects.toMatchObject({ message: 'context exhausted', status: 400 })
  })

  it('rejects when the server responds ok with no body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))

    await expect(
      requestCompletion({ messages: [], sessionId: 'sess-1', signal: new AbortController().signal }),
    ).rejects.toThrow('the server responded with no body')
  })
})

describe('readErrorMessage', () => {
  it('falls back to the generic status message when the body has no error field', async () => {
    expect(await readErrorMessage(new Response('not json', { status: 503 }))).toBe('the server responded 503')
    expect(await readErrorMessage(new Response('{}', { status: 503 }))).toBe('the server responded 503')
    expect(await readErrorMessage(new Response('{"error":""}', { status: 503 }))).toBe('the server responded 503')
    expect(await readErrorMessage(new Response('{"error":42}', { status: 503 }))).toBe('the server responded 503')
  })
})

describe('readDeltas malformed chunks', () => {
  function rawSSE(lines: string[]): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(lines.map((l) => `data: ${l}\n\n`).join('') + 'data: [DONE]\n\n')
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes)
        controller.close()
      },
    })
  }

  it('skips chunks with no choices, an empty choices array, or a non-object delta, without throwing', async () => {
    const deltas: ChatDelta[] = []
    for await (const delta of readDeltas(
      rawSSE([
        'not json at all',
        JSON.stringify({ id: 'x' }),
        JSON.stringify({ choices: [] }),
        JSON.stringify({ choices: [{ delta: null }] }),
        JSON.stringify({ choices: [{ delta: { content: 'ok' } }] }),
      ]),
    )) {
      deltas.push(delta)
    }
    expect(deltas).toEqual([{ text: 'ok', tools: undefined, citations: undefined }])
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

describe('context usage', () => {
  const CONTEXT = { usedTokens: 13200, maxTokens: 16384, exhausted: true }

  it('reads a context-only chunk from the stream', async () => {
    const deltas: ChatDelta[] = []
    for await (const delta of readDeltas(sseBody([{ context: CONTEXT }]))) deltas.push(delta)
    expect(deltas).toEqual([{ text: undefined, tools: undefined, citations: undefined, context: CONTEXT }])
  })

  it('keeps a well-formed usage', () => {
    expect(parseContextUsage(CONTEXT)).toEqual(CONTEXT)
  })

  it('returns undefined for anything malformed', () => {
    expect(parseContextUsage(undefined)).toBeUndefined()
    expect(parseContextUsage({ ...CONTEXT, usedTokens: '13200' })).toBeUndefined()
    expect(parseContextUsage({ usedTokens: 13200, maxTokens: 16384 })).toBeUndefined()
  })
})
