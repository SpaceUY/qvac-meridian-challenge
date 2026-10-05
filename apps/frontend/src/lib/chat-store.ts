// The chat state, in Zustand.

import { create } from 'zustand'
import { deleteSessionCache } from '@/lib/chat-client'
import type { Citation, ContextUsage, History, Message, Role } from '@/lib/chat-types'
import { revokeAttachments, type ImageAttachment } from '@/lib/image-attachments'

type ChatStore = {
  history: History
  /** Identifies the current conversation on every request (CONFIG.sessionHeader). conversationReset replaces it. */
  sessionId: string
  /** Abort handle of the text turn in flight, if any - lives here (not a ref in useChat) so Stop and New chat can both reach it. */
  activeTurn: AbortController | null
  /**
   * The assistant message whose audio is playing - or waiting for its next
   * chunk - right now, if any. AudioPlayback reports it; the composer keeps
   * Stop showing while it is set, since for the user a voice turn ends when
   * the voice goes quiet, not when the backend is done. Clearing it is how
   * Stop, a new voice turn or New chat silence that message.
   */
  speakingMessageId: string | null
  /** The backend reported this conversation's context window full (ContextUsage.exhausted). Stays true until New chat: the composer is disabled, the conversation stays readable. */
  contextExhausted: boolean
  /** Whether the "conversation full" notice is showing. Opens once, when contextExhausted first turns true; OK closes it without unlocking anything. */
  contextNoticeOpen: boolean
  contextUsageReceived: (usage: ContextUsage) => void
  contextNoticeDismissed: () => void
  turnStarted: (
    userMessageId: string,
    assistantMessageId: string,
    text: string,
    images?: ImageAttachment[],
  ) => void
  chunkReceived: (id: string, delta: string) => void
  citationsReceived: (id: string, citations: Citation[]) => void
  toolsReceived: (id: string, tools: string[]) => void
  responseFinished: (id: string) => void
  responseFailed: (id: string, reason: string) => void
  imagesDropped: (id: string) => void
  voiceTurnStarted: (userMessageId: string, assistantMessageId: string) => void
  voiceAudioChunkReceived: (id: string, dataUrl: string) => void
  voiceTranscriptReceived: (id: string, transcript: string) => void
  activeTurnStarted: (controller: AbortController) => void
  activeTurnSettled: (controller: AbortController) => void
  speechStarted: (id: string) => void
  speechEnded: (id: string) => void
  speechStopped: () => void
  turnStopped: () => void
  conversationReset: () => void
}

export const useChatStore = create<ChatStore>((set, get) => ({
  history: [],
  sessionId: crypto.randomUUID(),
  activeTurn: null,
  speakingMessageId: null,
  contextExhausted: false,
  contextNoticeOpen: false,

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

  /** Strips `images` off a message the backend rejected with a 400 - every future turn resends the full history, so a bad image would keep failing forever otherwise. See use-chat.ts's runTurn. */
  imagesDropped: (id) =>
    set((state) => ({
      history: withMessage(state.history, id, (m) => ({ ...m, images: undefined })),
    })),

  /** The transcript isn't known yet (it arrives in the voice endpoint's final SSE event), so the user message starts empty until voiceTranscriptReceived backfills it. */
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

  /** Only clears the handle if it's still this turn's - a newer turn's handle must survive a stale settle. */
  activeTurnSettled: (controller) =>
    set((state) => (state.activeTurn === controller ? { activeTurn: null } : {})),

  speechStarted: (id) => set({ speakingMessageId: id }),

  /** Only clears it if that message is still the one speaking - another may have taken over since. */
  speechEnded: (id) => set((state) => (state.speakingMessageId === id ? { speakingMessageId: null } : {})),

  speechStopped: () => set({ speakingMessageId: null }),

  /** The composer's Stop: aborts the turn in flight, if any (the backend stops on disconnect), and silences whatever is playing. */
  turnStopped: () => {
    get().activeTurn?.abort()
    set({ speakingMessageId: null })
  },

  /** Only the first "exhausted" opens the notice - later ones (a voice turn that was already in flight) leave it as the user left it. */
  contextUsageReceived: (usage) =>
    set((state) => (usage.exhausted && !state.contextExhausted ? { contextExhausted: true, contextNoticeOpen: true } : {})),

  contextNoticeDismissed: () => set({ contextNoticeOpen: false }),

  /** New chat: aborts the in-flight turn (backend cancels generation on disconnect - req. [1.4]), frees image previews, and fire-and-forgets freeing the old session's KV cache. */
  conversationReset: () => {
    const { activeTurn, history, sessionId } = get()
    activeTurn?.abort()
    deleteSessionCache(sessionId).catch((error: unknown) => {
      console.error('Could not delete the KV cache of the previous chat', error)
    })
    revokeAttachments(history.flatMap((message) => message.images ?? []))
    set({
      history: [],
      sessionId: crypto.randomUUID(),
      activeTurn: null,
      speakingMessageId: null,
      contextExhausted: false,
      contextNoticeOpen: false,
    })
  },
}))

/** A newborn message, without citations yet. It cannot be born failed. */
function createMessage(id: string, role: Role, text: string, status: 'done' | 'streaming'): Message {
  return { id, role, text, citations: [], tools: [], status: { type: status } }
}

/** Replaces one message without mutating; untouched messages keep their reference so React skips repainting them. */
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
