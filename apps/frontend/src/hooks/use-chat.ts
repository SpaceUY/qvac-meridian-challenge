// ---------------------------------------------------------------------------
// THE CHAT HOOK
//
// Orchestrates the conversation turn. It does NOT know what an HTTP header is or how a
// field is called in the OpenAI format: that's what chat-client.ts is for. Here only
// live the three things that are React: the state, the refs and the lifecycle
// of the component.
// ---------------------------------------------------------------------------

import { useCallback, useRef } from 'react'
import { useMirrorRef } from '@/hooks/use-mirror-ref'
import {
  toOpenAIMessages,
  EngineError,
  readDeltas,
  requestCompletion,
  type OpenAIMessage,
} from '@/lib/chat-client'
import { useChatStore, isWaitingForFirstChunk, isStreaming } from '@/lib/chat-store'

function useSessionId(): string {
  const ref = useRef<string | null>(null)
  if (ref.current === null) ref.current = crypto.randomUUID()
  return ref.current
}

export function useChat() {
  const history = useChatStore((state) => state.history)
  const sessionId = useSessionId()
  // The history "from before this turn" - see the comment in useMirrorRef.
  const historyRef = useMirrorRef(history)
  // The request in progress, if any. It also serves as a guard: we do not send a
  // new question while the previous one is still arriving.
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback((rawText: string) => {
    const text = rawText.trim()
    if (!text || abortRef.current) return

    const openAIMessages: OpenAIMessage[] = [
      ...toOpenAIMessages(historyRef.current),
      { role: 'user', content: text },
    ]

    const userMessageId = crypto.randomUUID()
    const assistantMessageId = crypto.randomUUID()
    useChatStore.getState().turnStarted(userMessageId, assistantMessageId, text)

    const controller = new AbortController()
    abortRef.current = controller

    runTurn({ openAIMessages, sessionId, assistantMessageId, signal: controller.signal }).finally(() => {
      abortRef.current = null
    })
  }, []) // no dependencies: reads everything it needs from refs, never gets stale

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return {
    history,
    sendMessage,
    stop,
    isWaitingForFirstChunk: isWaitingForFirstChunk(history),
    isStreaming: isStreaming(history),
  }
}

// Cuántos pedacitos de red juntamos antes de mandar el texto acumulado al
// store, en vez de mandar uno por uno.
const CHUNKS_PER_BATCH = 2

async function runTurn(args: {
  openAIMessages: OpenAIMessage[]
  sessionId: string
  assistantMessageId: string
  signal: AbortSignal
}) {
  const { openAIMessages, sessionId, assistantMessageId, signal } = args
  const buffer = createChunkBuffer(assistantMessageId)
  try {
    const body = await requestCompletion({ messages: openAIMessages, sessionId, signal })
    for await (const delta of readDeltas(body)) {
      if (delta.text !== undefined) buffer.add(delta.text)
      if (delta.citations !== undefined) {
        useChatStore.getState().citationsReceived(assistantMessageId, delta.citations)
      }
    }
    buffer.flush()
    useChatStore.getState().responseFinished(assistantMessageId)
  } catch (err) {
    buffer.flush() // no perder el pedacito de texto que todavía no se mandó
    if (err instanceof DOMException && err.name === 'AbortError') {
      useChatStore.getState().responseFinished(assistantMessageId) // cancelled on purpose: not an error
      return
    }
    const reason = err instanceof EngineError ? err.message : 'could not reach the model'
    useChatStore.getState().responseFailed(assistantMessageId, reason)
  }
}

/**
 * Junta el texto que va llegando y lo manda al store cada CHUNKS_PER_BATCH
 * pedacitos, en vez de uno por uno. Alcanza con UN buffer (no un Map por
 * mensaje, como en Rumii) porque acá nunca hay dos respuestas transmitiendo
 * al mismo tiempo.
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
