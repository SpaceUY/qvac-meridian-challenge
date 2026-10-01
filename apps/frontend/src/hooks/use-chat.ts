// ---------------------------------------------------------------------------
// THE CHAT HOOK
//
// Orchestrates the conversation turn. It does NOT know what an HTTP header is or how a
// field is called in the OpenAI format: that's what chat-client.ts is for. Here only
// live the three things that are React: the state, the refs and the lifecycle
// of the component.
// ---------------------------------------------------------------------------

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useMirrorRef } from '@/hooks/use-mirror-ref'
import { toOpenAIMessages, EngineError, readDeltas, requestCompletion } from '@/lib/chat-client'
import { useChatStore, isWaitingForFirstChunk, isStreaming } from '@/lib/chat-store'
import type { Message } from '@/lib/chat-types'
import { revokeAttachments, type ImageAttachment } from '@/lib/image-attachments'

/** What a turn needs to be re-serialized to the wire format - never the full Message (citations/status are UI-only, irrelevant to the request). */
type HistoryEntry = Pick<Message, 'role' | 'text' | 'images'>

/** Everything one turn needs, captured at send time. */
type Turn = {
  history: HistoryEntry[]
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  controller: AbortController
}

export function useChat() {
  const history = useChatStore((state) => state.history)
  // The history "from before this turn" - see the comment in useMirrorRef.
  const historyRef = useMirrorRef(history)

  const { mutate } = useMutation({
    mutationFn: runTurn,
    // Here and not on mutate(): the mutation-level callback fires even if
    // the component unmounted mid-turn.
    onSettled: (_data, _error, turn) => useChatStore.getState().activeTurnSettled(turn.controller),
  })

  const sendMessage = useCallback(
    (rawText: string, images: ImageAttachment[] = []) => {
      const text = rawText.trim()
      const store = useChatStore.getState()
      // activeTurn doubles as the guard: no new question while the previous one is still arriving.
      if ((!text && images.length === 0) || store.activeTurn) return

      const userMessageId = crypto.randomUUID()
      const assistantMessageId = crypto.randomUUID()
      store.turnStarted(userMessageId, assistantMessageId, text, images)

      const controller = new AbortController()
      store.activeTurnStarted(controller)
      mutate({
        history: [...historyRef.current, { role: 'user', text, images }],
        sessionId: store.sessionId,
        userMessageId,
        assistantMessageId,
        controller,
      })
    },
    [historyRef, mutate],
  )

  const stop = useCallback(() => useChatStore.getState().activeTurn?.abort(), [])

  return {
    history,
    sendMessage,
    stop,
    isWaitingForFirstChunk: isWaitingForFirstChunk(history),
    isStreaming: isStreaming(history),
  }
}

// How many network chunks we batch before sending the accumulated text to
// the store, instead of sending one at a time.
const CHUNKS_PER_BATCH = 2

async function runTurn({ history, sessionId, userMessageId, assistantMessageId, controller }: Turn) {
  const buffer = createChunkBuffer(assistantMessageId)
  try {
    // Reads any attached File(s) into base64 here, right before the
    // request goes out - not earlier (see toOpenAIMessages's own doc).
    const openAIMessages = await toOpenAIMessages(history)
    const body = await requestCompletion({ messages: openAIMessages, sessionId, signal: controller.signal })
    for await (const delta of readDeltas(body)) {
      if (delta.text !== undefined) buffer.add(delta.text)
      if (delta.tools !== undefined) {
        useChatStore.getState().toolsReceived(assistantMessageId, delta.tools)
      }
      if (delta.citations !== undefined) {
        useChatStore.getState().citationsReceived(assistantMessageId, delta.citations)
      }
    }
    buffer.flush()
    useChatStore.getState().responseFinished(assistantMessageId)
  } catch (err) {
    buffer.flush() // don't lose the bit of text that hadn't been sent yet
    if (err instanceof DOMException && err.name === 'AbortError') {
      useChatStore.getState().responseFinished(assistantMessageId) // cancelled on purpose: not an error
      return
    }
    // A 400 means THIS request, as constructed, will never succeed by
    // retrying it - e.g. an image the backend's real (magic-byte) check
    // rejected. Every future turn resends the whole history, so leaving a
    // known-bad image in place would fail every turn after this one
    // forever (text or voice alike, since both read the same history) -
    // drop it now, once, right after the request that proved it's bad.
    if (err instanceof EngineError && err.status === 400) {
      const images = useChatStore.getState().history.find((m) => m.id === userMessageId)?.images
      if (images?.length) revokeAttachments(images)
      useChatStore.getState().imagesDropped(userMessageId)
    }
    const reason = err instanceof EngineError ? err.message : 'could not reach the model'
    useChatStore.getState().responseFailed(assistantMessageId, reason)
  }
}

/**
 * Collects incoming text and sends it to the store every CHUNKS_PER_BATCH
 * chunks, instead of one at a time. A single buffer is enough (not a Map
 * per message, like in Rumii) because there are never two responses
 * streaming at the same time here.
 */
function createChunkBuffer(messageId: string) {
  let pendingText = ''
  let pendingCount = 0

  const flush = () => {
    if (pendingText === '') return
    useChatStore.getState().chunkReceived(messageId, pendingText)
    pendingText = ''
    pendingCount = 0
  }

  const add = (text: string) => {
    pendingText += text
    pendingCount += 1
    if (pendingCount >= CHUNKS_PER_BATCH) flush()
  }

  return { add, flush }
}
