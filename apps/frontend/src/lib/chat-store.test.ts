import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/lib/chat-store'

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
