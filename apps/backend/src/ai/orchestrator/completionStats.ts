import type { BaseMessage } from "@langchain/core/messages";
import type { ChatCompletionStats } from "../../models/domain/types.js";

/**
 * The SDK's per-call token counters, as they reach the graph: `ChatQVAC`
 * puts them in the last stream chunk's `generationInfo.stats`, and
 * @langchain/core's `_streamIterator` copies `generationInfo` into the
 * chunk's `response_metadata` - so they survive `generateReply`'s concat.
 * Undefined when the call reported none (a fake model in a test, a runtime
 * that sends no stats).
 */
export function readCompletionStats(message: BaseMessage): ChatCompletionStats | undefined {
  const metadata: Record<string, unknown> | undefined = message.response_metadata;
  const raw = metadata?.stats;
  if (typeof raw !== "object" || raw === null) return undefined;

  const source = raw as Record<string, unknown>;
  const stats: ChatCompletionStats = {};
  for (const key of ["cacheTokens", "promptTokens", "generatedTokens"] as const) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value)) stats[key] = value;
  }
  return Object.keys(stats).length > 0 ? stats : undefined;
}
