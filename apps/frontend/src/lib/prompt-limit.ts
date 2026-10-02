// How long one typed question may be. The backend embeds at most this many
// characters of a message to search the corpus (MAX_RETRIEVAL_QUERY_CHARS in
// apps/backend/src/config/rag.config.ts) - the same number on purpose: a
// longer question would be searched by its first part only, silently.
// Counted in UTF-16 units, exactly what a <textarea>'s maxLength counts.
export const MAX_PROMPT_CHARS = 700

/** From this many characters left, the composer shows the counter. */
const COUNTER_VISIBLE_FROM = 100

export type PromptLimitState = {
  remaining: number
  showCounter: boolean
  atLimit: boolean
}

export function promptLimitState(text: string): PromptLimitState {
  const remaining = Math.max(0, MAX_PROMPT_CHARS - text.length)
  return { remaining, showCounter: remaining <= COUNTER_VISIBLE_FROM, atLimit: remaining === 0 }
}
