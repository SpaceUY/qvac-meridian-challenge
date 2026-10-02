/**
 * Share of the chat model's context window one conversation may fill
 * before the app stops taking new messages in it (the user is asked to
 * start a new chat). The measurement only exists once a turn has finished,
 * and it blocks the NEXT one - so the margin above it is what keeps that
 * last allowed turn from overflowing. One turn can add 1k+ tokens at once
 * (a tool loop makes several model calls; each prompt carries retrieved
 * chunks), hence 0.8 and not closer to 1.
 */
export const CONTEXT_BUDGET_THRESHOLD = 0.8;
