import type { ChatCompletionStats } from "../../models/domain/types.js";

/** How full one conversation's context window is, measured once a turn finished. Sent to the client as-is (it is already JSON). */
export interface ContextUsage {
  usedTokens: number;
  maxTokens: number;
  /** `usedTokens / maxTokens` reached the budget threshold: this conversation takes no new messages. */
  exhausted: boolean;
}

/**
 * Pure: no model, no I/O. `cacheTokens` first - it is what the session's
 * KV cache holds after the call, the number that grows turn after turn and
 * that a prefill overflow is measured against. Falls back to
 * prompt + generated when a runtime reports no cache counter. Undefined
 * when there is nothing to measure, so callers send no signal rather than
 * a made-up one.
 */
export function measureContextUsage(
  stats: ChatCompletionStats | undefined,
  maxTokens: number,
  threshold: number,
): ContextUsage | undefined {
  const usedTokens = stats?.cacheTokens ?? sumIfBoth(stats?.promptTokens, stats?.generatedTokens);
  if (usedTokens === undefined || maxTokens <= 0) return undefined;
  return { usedTokens, maxTokens, exhausted: usedTokens / maxTokens >= threshold };
}

function sumIfBoth(a: number | undefined, b: number | undefined): number | undefined {
  return a !== undefined && b !== undefined ? a + b : undefined;
}
