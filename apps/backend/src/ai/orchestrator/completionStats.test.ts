import { describe, expect, it } from "vitest";
import { AIMessage, AIMessageChunk } from "@langchain/core/messages";
import { readCompletionStats } from "./completionStats.js";

describe("readCompletionStats", () => {
  it("reads the SDK counters from response_metadata.stats", () => {
    const message = new AIMessageChunk({
      content: "ok",
      response_metadata: { stats: { cacheTokens: 900, promptTokens: 700, generatedTokens: 20, tokensPerSecond: 31 } },
    });

    expect(readCompletionStats(message)).toEqual({ cacheTokens: 900, promptTokens: 700, generatedTokens: 20 });
  });

  it("returns undefined when the call reported no stats", () => {
    expect(readCompletionStats(new AIMessage("ok"))).toBeUndefined();
  });

  it("ignores counters that are not finite numbers", () => {
    const message = new AIMessage({ content: "ok", response_metadata: { stats: { cacheTokens: "900", promptTokens: 700 } } });

    expect(readCompletionStats(message)).toEqual({ promptTokens: 700 });
  });
});
