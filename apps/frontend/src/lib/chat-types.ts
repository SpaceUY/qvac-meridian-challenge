// The chat types. They live apart from the reducer and the hook so that a
// component that only needs to know "what shape a Message has" does not have
// to drag in the logic of how the state changes.

import type { ImageAttachment } from '@/lib/image-attachments'

export type Role = 'user' | 'assistant'

export type Citation = {
  file: string
  score?: number
}

/**
 * Where a message is in its life. A discriminated union: `type` is the tag
 * TypeScript reads to know which of the three shapes it is holding, and only
 * the 'error' one carries a reason. That is the point — you cannot read
 * `reason` without first proving the message actually failed.
 */
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

/**
 * The conversation: the list of messages, in order.
 *
 * It is the bare array, with no wrapper. It used to be { messages: Message[] },
 * but the wrapper held nothing else and forced `{ ...state, messages: ... }` in
 * every branch of the reducer. If some day something else needs to live next to
 * the conversation, we wrap it again.
 */
export type History = Message[]
