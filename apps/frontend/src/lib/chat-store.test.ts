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
