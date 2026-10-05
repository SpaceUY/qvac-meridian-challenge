import type { BaseMessage } from "@langchain/core/messages";
import type { ChatCompletionStats } from "../../models/domain/types.js";

/** Reads the SDK's per-call token counters from `response_metadata.stats` (placed there via `ChatQVAC`'s stream chunk + `@langchain/core`'s concat); undefined when the runtime reported none. */
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
