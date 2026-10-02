import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('citedChunksReceived', () => {
  it('attaches the passages to the message with that id, and a new message starts with none', () => {
    useChatStore.getState().turnStarted('user-2', 'assistant-2', 'What was Q2 revenue?')
    const find = () => useChatStore.getState().history.find((m) => m.id === 'assistant-2')
    expect(find()?.citedChunks).toEqual([])

    const citedChunks = [{ file: 'reports/q2.md', chunkIndex: 3, score: 0.83, content: 'Q2 revenue was $18.4M.' }]
    useChatStore.getState().citedChunksReceived('assistant-2', citedChunks)

    expect(find()?.citedChunks).toEqual(citedChunks)
    expect(useChatStore.getState().history.find((m) => m.id === 'user-2')?.citedChunks).toEqual([])
  })
})
