// El estado del chat, en Zustand. Reemplaza a chat-reducer.ts: cada "case" que
// tenía el reducer ahora es una función del store, con los mismos parámetros
// que antes venían adentro del objeto-acción.

import { create } from 'zustand'
import type { Citation, History, Message, Role } from '@/lib/chat-types'

type ChatStore = {
  history: History
  turnStarted: (userMessageId: string, assistantMessageId: string, text: string) => void
  chunkReceived: (id: string, delta: string) => void
  citationsReceived: (id: string, citations: Citation[]) => void
  responseFinished: (id: string) => void
  responseFailed: (id: string, reason: string) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  history: [],

  turnStarted: (userMessageId, assistantMessageId, text) =>
    set((state) => ({
      history: [
        ...state.history,
        createMessage(userMessageId, 'user', text, 'done'),
        createMessage(assistantMessageId, 'assistant', '', 'streaming'),
      ],
    })),

  chunkReceived: (id, delta) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, text: m.text + delta })),
    })),

  citationsReceived: (id, citations) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, citations })),
    })),

  responseFinished: (id) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, status: { type: 'done' } })),
    })),

  responseFailed: (id, reason) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, status: { type: 'error', reason } })),
    })),
}))

/** A newborn message, without citations yet. It cannot be born failed. */
function createMessage(id: string, role: Role, text: string, status: 'done' | 'streaming'): Message {
  return { id, role, text, citations: [], status: { type: status } }
}

/**
 * Returns a new history with ONE single message replaced, without mutating
 * anything. Messages that do not change are returned as-is — the same object in
 * memory — so React knows there is no need to repaint them.
 */
function withMessage(history: History, id: string, change: (m: Message) => Message): History {
  return history.map((m) => (m.id === id ? change(m) : m))
}

export function isWaitingForFirstChunk(history: History): boolean {
  const last = history.at(-1)
  return last?.role === 'assistant' && last.status.type === 'streaming' && last.text === ''
}

export function isStreaming(history: History): boolean {
  return history.at(-1)?.status.type === 'streaming'
}
