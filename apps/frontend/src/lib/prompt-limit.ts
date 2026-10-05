// Matches the backend's MAX_RETRIEVAL_QUERY_CHARS (apps/backend/src/config/rag.config.ts) exactly - a longer question would otherwise be searched by its first part only, silently. Counted in UTF-16 units, same as a <textarea>'s maxLength.
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
