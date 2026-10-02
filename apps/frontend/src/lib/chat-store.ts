// The chat state, in Zustand. Replaces chat-reducer.ts: every "case" the
// reducer used to have is now a function on the store, with the same
// parameters that used to live inside the action object.

import { create } from 'zustand'
import { deleteSessionCache } from '@/lib/chat-client'
import type { Citation, CitedChunk, History, Message, Role } from '@/lib/chat-types'
import { revokeAttachments, type ImageAttachment } from '@/lib/image-attachments'

type ChatStore = {
  history: History
  /** Identifies the current conversation on every request (CONFIG.sessionHeader). conversationReset replaces it. */
  sessionId: string
  /**
   * The abort handle of the text turn in flight, if any. Not render state:
   * no component selects it. It lives here - not in a ref inside useChat -
   * so Stop (in the composer) and New chat (in the left sidebar) reach the
   * same handle from different parts of the tree.
   */
  activeTurn: AbortController | null
  turnStarted: (
    userMessageId: string,
    assistantMessageId: string,
    text: string,
    images?: ImageAttachment[],
  ) => void
  chunkReceived: (id: string, delta: string) => void
  citationsReceived: (id: string, citations: Citation[]) => void
  citedChunksReceived: (id: string, citedChunks: CitedChunk[]) => void
  toolsReceived: (id: string, tools: string[]) => void
  responseFinished: (id: string) => void
  responseFailed: (id: string, reason: string) => void
  imagesDropped: (id: string) => void
  voiceTurnStarted: (userMessageId: string, assistantMessageId: string) => void
  voiceAudioChunkReceived: (id: string, dataUrl: string) => void
  voiceTranscriptReceived: (id: string, transcript: string) => void
  activeTurnStarted: (controller: AbortController) => void
  activeTurnSettled: (controller: AbortController) => void
  conversationReset: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  history: [],
  sessionId: crypto.randomUUID(),
  activeTurn: null,

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

  citedChunksReceived: (id, citedChunks) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, citedChunks })),
    })),

  toolsReceived: (id, tools) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, tools })),
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

  /** The transcript isn't known yet (it arrives in the voice endpoint's final SSE event) - the user message starts empty, which MessageList already renders as no bubble at all (same as an image-only turn), until voiceTranscriptReceived backfills it. */
  voiceTurnStarted: (userMessageId, assistantMessageId) =>
    set((state) => ({
      history: [
        ...state.history,
        createMessage(userMessageId, 'user', '', 'done'),
        createMessage(assistantMessageId, 'assistant', '', 'streaming'),
      ],
    })),

  voiceAudioChunkReceived: (id, dataUrl) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({
        ...m,
        audioChunks: [...(m.audioChunks ?? []), { dataUrl }],
      })),
    })),

  voiceTranscriptReceived: (id, transcript) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, text: transcript })),
    })),

  activeTurnStarted: (controller) => set({ activeTurn: controller }),

  /**
   * Only clears the handle if it is still this turn's. A turn cancelled by
   * conversationReset settles a moment later - by then a new turn may
   * already be in flight, and its handle must survive.
   */
  activeTurnSettled: (controller) =>
    set((state) => (state.activeTurn === controller ? { activeTurn: null } : {})),

  /**
   * New chat. Aborts the turn in flight (the backend cancels generation on
   * disconnect - req. [1.4]), frees the image previews, and starts over
   * with a fresh sessionId, and asks the backend to free the old session's
   * KV cache - fire-and-forget: a failure is only logged, it never blocks
   * or undoes the new chat. Chunks still arriving for the old turn are
   * harmless: withMessage on an id that no longer exists changes nothing.
   */
  conversationReset: () => {
    const { activeTurn, history, sessionId } = get()
    activeTurn?.abort()
    deleteSessionCache(sessionId).catch((error: unknown) => {
      console.error('Could not delete the KV cache of the previous chat', error)
    })
    revokeAttachments(history.flatMap((message) => message.images ?? []))
    set({ history: [], sessionId: crypto.randomUUID(), activeTurn: null })
  },
}))

/** A newborn message, without citations yet. It cannot be born failed. */
function createMessage(id: string, role: Role, text: string, status: 'done' | 'streaming'): Message {
  return { id, role, text, citations: [], citedChunks: [], tools: [], status: { type: status } }
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
