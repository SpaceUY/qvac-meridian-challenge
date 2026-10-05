import type { ImageAttachment } from '@/lib/image-attachments'

export type Role = 'user' | 'assistant'

export type Citation = {
  file: string
  score?: number
}

/** Mirrors `ContextUsage` in apps/backend/src/ai/orchestrator/contextBudget.ts by hand (no shared package). */
export type ContextUsage = {
  usedTokens: number
  maxTokens: number
  /** The conversation reached the budget threshold: it takes no new messages. */
  exhausted: boolean
}

/** Discriminated union so `reason` is only reachable after narrowing to `'error'`. */
export type MessageStatus =
  | { type: 'streaming' }
  | { type: 'done' }
  | { type: 'error'; reason: string }

export type Message = {
  id: string
  role: Role
  text: string
  citations: Citation[]
  /** Names of tools (e.g. "lookup_stock") the agent used to produce this reply. Empty for a user message and for an assistant reply that used none. */
  tools: string[]
  status: MessageStatus
  /** Present only on assistant messages from a voice turn - one entry per synthesized sentence, appended as they stream in. A sentence whose synthesis failed server-side contributes no entry, but doesn't stop the others. */
  audioChunks?: { dataUrl: string }[]
  /** Images attached to this turn (user messages only). Set once at creation and never mutated afterwards - see chat-store.ts's turnStarted. */
  images?: ImageAttachment[]
}

export type History = Message[]
