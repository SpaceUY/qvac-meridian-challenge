/** Share of the context window one conversation may fill before new messages are blocked. The check only runs after a turn finishes, so the margin covers one more turn's worth of tokens (a tool loop can add 1k+ at once) - hence 0.8, not closer to 1. */
export const CONTEXT_BUDGET_THRESHOLD = 0.8;
