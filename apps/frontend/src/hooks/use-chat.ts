// Orchestrates the conversation turn; wire-format details live in chat-client.ts.

import { useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useMirrorRef } from '@/hooks/use-mirror-ref'
import { toOpenAIMessages, EngineError, readDeltas, requestCompletion } from '@/lib/chat-client'
import { useChatStore, isWaitingForFirstChunk, isStreaming } from '@/lib/chat-store'
import type { Message } from '@/lib/chat-types'
import { revokeAttachments, type ImageAttachment } from '@/lib/image-attachments'

/** Never the full Message - citations/status are UI-only and irrelevant to the request. */
type HistoryEntry = Pick<Message, 'role' | 'text' | 'images'>

type Turn = {
  history: HistoryEntry[]
  sessionId: string
  userMessageId: string
  assistantMessageId: string
  controller: AbortController
}

export function useChat() {
  const history = useChatStore((state) => state.history)
  // "Before this turn" snapshot - see useMirrorRef.
  const historyRef = useMirrorRef(history)

  const { mutate } = useMutation({
    mutationFn: runTurn,
    // On the mutation, not mutate(): fires even if the component unmounted mid-turn.
    onSettled: (_data, _error, turn) => useChatStore.getState().activeTurnSettled(turn.controller),
  })

  const sendMessage = useCallback(
    (rawText: string, images: ImageAttachment[] = []) => {
      const text = rawText.trim()
      const store = useChatStore.getState()
      // activeTurn blocks a new question mid-stream; contextExhausted blocks a full conversation.
      if ((!text && images.length === 0) || store.activeTurn || store.contextExhausted) return

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

const CHUNKS_PER_BATCH = 2

async function runTurn({ history, sessionId, userMessageId, assistantMessageId, controller }: Turn) {
  const buffer = createChunkBuffer(assistantMessageId)
  try {
    // Reads attached files to base64 here, right before the request (see toOpenAIMessages).
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
      if (delta.context !== undefined) {
        useChatStore.getState().contextUsageReceived(delta.context)
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
    // A 400 (e.g. an image rejected by the backend's magic-byte check) would repeat on every
    // future turn since each resends the whole history - drop the bad image now instead.
    if (err instanceof EngineError && err.status === 400) {
      const images = useChatStore.getState().history.find((m) => m.id === userMessageId)?.images
      if (images?.length) revokeAttachments(images)
      useChatStore.getState().imagesDropped(userMessageId)
    }
    const reason = err instanceof EngineError ? err.message : 'could not reach the model'
    useChatStore.getState().responseFailed(assistantMessageId, reason)
  }
}

/** A single buffer is enough (not a Map per message) - only one response streams at a time here. */
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
