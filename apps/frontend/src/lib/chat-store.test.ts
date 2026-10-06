import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isStreaming, isWaitingForFirstChunk, useChatStore } from '@/lib/chat-store'

describe('conversationReset', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('deletes the KV cache of the conversation it replaces', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
    const oldSessionId = useChatStore.getState().sessionId

    useChatStore.getState().conversationReset()

    expect(fetchMock).toHaveBeenCalledWith(`/api/chat/sessions/${oldSessionId}/cache`, { method: 'DELETE' })
    expect(useChatStore.getState().sessionId).not.toBe(oldSessionId)
  })

  it('still starts the new chat when deleting the cache fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const oldSessionId = useChatStore.getState().sessionId

    useChatStore.getState().conversationReset()
    await vi.waitFor(() => expect(consoleError).toHaveBeenCalled())

    expect(useChatStore.getState().sessionId).not.toBe(oldSessionId)
    expect(useChatStore.getState().history).toEqual([])
  })
})

describe('toolsReceived', () => {
  it('attaches the tool names to the message with that id', () => {
    useChatStore.getState().turnStarted('user-1', 'assistant-1', 'How many SD-X4-001 in stock?')

    useChatStore.getState().toolsReceived('assistant-1', ['lookup_stock'])

    const message = useChatStore.getState().history.find((m) => m.id === 'assistant-1')
    expect(message?.tools).toEqual(['lookup_stock'])
  })
})

describe('a text turn', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    useChatStore.getState().conversationReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('streams deltas, citations and finishes into the assistant message', () => {
    useChatStore.getState().turnStarted('user-1', 'assistant-1', 'What is the P1 SLA?')

    useChatStore.getState().chunkReceived('assistant-1', 'Enterprise P1 ')
    useChatStore.getState().chunkReceived('assistant-1', 'SLA is 4 hours.')
    useChatStore.getState().citationsReceived('assistant-1', [{ file: 'policies/sla.md', score: 0.9 }])
    useChatStore.getState().responseFinished('assistant-1')

    const message = useChatStore.getState().history.find((m) => m.id === 'assistant-1')
    expect(message).toMatchObject({
      text: 'Enterprise P1 SLA is 4 hours.',
      citations: [{ file: 'policies/sla.md', score: 0.9 }],
      status: { type: 'done' },
    })
  })

  it('records the failure reason without touching the text already streamed', () => {
    useChatStore.getState().turnStarted('user-1', 'assistant-1', 'hi')
    useChatStore.getState().chunkReceived('assistant-1', 'partial')

    useChatStore.getState().responseFailed('assistant-1', 'network error')

    const message = useChatStore.getState().history.find((m) => m.id === 'assistant-1')
    expect(message).toMatchObject({ text: 'partial', status: { type: 'error', reason: 'network error' } })
  })

  it('carries attached images on the user message and drops them once rejected', () => {
    const images = [{ id: '1', file: new File([], 'part.png'), previewUrl: 'blob:a', mimeType: 'image/png' as const }]
    useChatStore.getState().turnStarted('user-1', 'assistant-1', 'what is this part?', images)

    expect(useChatStore.getState().history.find((m) => m.id === 'user-1')?.images).toEqual(images)

    useChatStore.getState().imagesDropped('user-1')

    expect(useChatStore.getState().history.find((m) => m.id === 'user-1')?.images).toBeUndefined()
  })
})

describe('a voice turn', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    useChatStore.getState().conversationReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('starts with an empty user message and fills it in once the transcript arrives', () => {
    useChatStore.getState().voiceTurnStarted('user-1', 'assistant-1')
    expect(useChatStore.getState().history.find((m) => m.id === 'user-1')?.text).toBe('')

    useChatStore.getState().voiceAudioChunkReceived('assistant-1', 'data:audio/wav;base64,aaa')
    useChatStore.getState().voiceAudioChunkReceived('assistant-1', 'data:audio/wav;base64,bbb')
    useChatStore.getState().voiceTranscriptReceived('user-1', 'How many SD-X4-001 are in stock?')

    expect(useChatStore.getState().history.find((m) => m.id === 'user-1')?.text).toBe(
      'How many SD-X4-001 are in stock?',
    )
    expect(useChatStore.getState().history.find((m) => m.id === 'assistant-1')?.audioChunks).toEqual([
      { dataUrl: 'data:audio/wav;base64,aaa' },
      { dataUrl: 'data:audio/wav;base64,bbb' },
    ])
  })
})

describe('activeTurnSettled', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    useChatStore.getState().conversationReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('clears the handle once that turn settles', () => {
    const controller = new AbortController()
    useChatStore.getState().activeTurnStarted(controller)

    useChatStore.getState().activeTurnSettled(controller)

    expect(useChatStore.getState().activeTurn).toBeNull()
  })

  it('leaves a newer handle alone when a stale turn settles late', () => {
    const stale = new AbortController()
    const current = new AbortController()
    useChatStore.getState().activeTurnStarted(stale)
    useChatStore.getState().activeTurnStarted(current)

    useChatStore.getState().activeTurnSettled(stale)

    expect(useChatStore.getState().activeTurn).toBe(current)
  })
})

describe('isWaitingForFirstChunk', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    useChatStore.getState().conversationReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('is true for an empty, still-streaming assistant message', () => {
    useChatStore.getState().turnStarted('user-1', 'assistant-1', 'hi')
    expect(isWaitingForFirstChunk(useChatStore.getState().history)).toBe(true)
  })

  it('is false once a chunk has arrived or the turn is done', () => {
    useChatStore.getState().turnStarted('user-1', 'assistant-1', 'hi')
    useChatStore.getState().chunkReceived('assistant-1', 'hello')
    expect(isWaitingForFirstChunk(useChatStore.getState().history)).toBe(false)

    useChatStore.getState().responseFinished('assistant-1')
    expect(isWaitingForFirstChunk(useChatStore.getState().history)).toBe(false)
  })
})

describe('isStreaming', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    useChatStore.getState().conversationReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reflects whether the last message in history is still streaming', () => {
    useChatStore.getState().turnStarted('user-1', 'assistant-1', 'hi')
    expect(isStreaming(useChatStore.getState().history)).toBe(true)

    useChatStore.getState().responseFinished('assistant-1')
    expect(isStreaming(useChatStore.getState().history)).toBe(false)
  })

  it('is false for an empty history', () => {
    expect(isStreaming([])).toBe(false)
  })
})

describe('context budget', () => {
  const FULL = { usedTokens: 13200, maxTokens: 16384, exhausted: true }
  const ROOMY = { usedTokens: 900, maxTokens: 16384, exhausted: false }

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    useChatStore.getState().conversationReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('locks the conversation and opens the notice once the backend says it is full', () => {
    useChatStore.getState().contextUsageReceived(FULL)
    expect(useChatStore.getState()).toMatchObject({ contextExhausted: true, contextNoticeOpen: true })
  })

  it('ignores a usage that still has room', () => {
    useChatStore.getState().contextUsageReceived(ROOMY)
    expect(useChatStore.getState()).toMatchObject({ contextExhausted: false, contextNoticeOpen: false })
  })

  it('stays locked after OK, without reopening the notice', () => {
    useChatStore.getState().contextUsageReceived(FULL)
    useChatStore.getState().contextNoticeDismissed()
    useChatStore.getState().contextUsageReceived(FULL)
    expect(useChatStore.getState()).toMatchObject({ contextExhausted: true, contextNoticeOpen: false })
  })

  it('unlocks on New chat', () => {
    useChatStore.getState().contextUsageReceived(FULL)
    useChatStore.getState().conversationReset()
    expect(useChatStore.getState()).toMatchObject({ contextExhausted: false, contextNoticeOpen: false })
  })
})

describe('speech', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })))
    useChatStore.getState().conversationReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('remembers which message is speaking', () => {
    useChatStore.getState().speechStarted('assistant-1')
    expect(useChatStore.getState().speakingMessageId).toBe('assistant-1')
  })

  it('only ends the speech of the message that is still speaking', () => {
    useChatStore.getState().speechStarted('assistant-2')
    useChatStore.getState().speechEnded('assistant-1')
    expect(useChatStore.getState().speakingMessageId).toBe('assistant-2')

    useChatStore.getState().speechEnded('assistant-2')
    expect(useChatStore.getState().speakingMessageId).toBeNull()
  })

  it('Stop aborts the turn in flight and silences what is playing', () => {
    const controller = new AbortController()
    useChatStore.getState().activeTurnStarted(controller)
    useChatStore.getState().speechStarted('assistant-1')

    useChatStore.getState().turnStopped()

    expect(controller.signal.aborted).toBe(true)
    expect(useChatStore.getState().speakingMessageId).toBeNull()
  })

  it('Stop with only audio playing (the backend already done) just silences it', () => {
    useChatStore.getState().speechStarted('assistant-1')
    useChatStore.getState().turnStopped()
    expect(useChatStore.getState().speakingMessageId).toBeNull()
  })

  it('speechStopped silences what is playing without touching the turn in flight', () => {
    const controller = new AbortController()
    useChatStore.getState().activeTurnStarted(controller)
    useChatStore.getState().speechStarted('assistant-1')

    useChatStore.getState().speechStopped()

    expect(controller.signal.aborted).toBe(false)
    expect(useChatStore.getState().speakingMessageId).toBeNull()
  })

  it('New chat silences what is playing', () => {
    useChatStore.getState().speechStarted('assistant-1')
    useChatStore.getState().conversationReset()
    expect(useChatStore.getState().speakingMessageId).toBeNull()
  })
})
