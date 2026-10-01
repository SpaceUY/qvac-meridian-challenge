// The chat state, in Zustand. Replaces chat-reducer.ts: every "case" the
// reducer used to have is now a function on the store, with the same
// parameters that used to live inside the action object.

import { create } from 'zustand'
import type { Citation, History, Message, Role } from '@/lib/chat-types'
import type { ImageAttachment } from '@/lib/image-attachments'

type ChatStore = {
  history: History
  turnStarted: (
    userMessageId: string,
    assistantMessageId: string,
    text: string,
    images?: ImageAttachment[],
  ) => void
  chunkReceived: (id: string, delta: string) => void
  citationsReceived: (id: string, citations: Citation[]) => void
  responseFinished: (id: string) => void
  responseFailed: (id: string, reason: string) => void
  imagesDropped: (id: string) => void
  voiceTurnAdded: (params: {
    userMessageId: string
    transcript: string
    assistantMessageId: string
    answer: string
    citations: Citation[]
    audio?: { dataUrl: string }
  }) => void
}

export const useChatStore = create<ChatStore>((set) => ({
  history: [],

  turnStarted: (userMessageId, assistantMessageId, text, images) =>
    set((state) => ({
      history: [
        ...state.history,
        {
          ...createMessage(userMessageId, 'user', text, 'done'),
          ...(images?.length ? { images } : {}),
        },
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

  /**
   * Strips `images` off a message that the backend rejected with a 400 -
   * that request will never succeed by retrying it as-is, and every future
   * turn resends the *entire* history, so leaving the same bad image(s) in
   * place would keep failing every turn after this one forever, whatever
   * they contain (text, voice, another image). Called once, right after
   * the 400 - see use-chat.ts's runTurn.
   */
  imagesDropped: (id) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, images: undefined })),
    })),

  voiceTurnAdded: ({ userMessageId, transcript, assistantMessageId, answer, citations, audio }) =>
    set((state) => ({
      history: [
        ...state.history,
        createMessage(userMessageId, 'user', transcript, 'done'),
        { ...createMessage(assistantMessageId, 'assistant', answer, 'done'), citations, audio },
      ],
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
