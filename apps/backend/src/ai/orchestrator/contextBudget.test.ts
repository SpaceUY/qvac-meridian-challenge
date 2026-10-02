import { describe, expect, it } from "vitest";
import { measureContextUsage } from "./contextBudget.js";

describe("measureContextUsage", () => {
  it("leaves a conversation open below the threshold", () => {
    expect(measureContextUsage({ cacheTokens: 799 }, 1000, 0.8)).toEqual({ usedTokens: 799, maxTokens: 1000, exhausted: false });
  });

  it("marks it exhausted from exactly the threshold", () => {
    expect(measureContextUsage({ cacheTokens: 800 }, 1000, 0.8)).toMatchObject({ exhausted: true });
  });

  it("prefers cacheTokens over prompt + generated", () => {
    expect(measureContextUsage({ cacheTokens: 900, promptTokens: 100, generatedTokens: 10 }, 1000, 0.8)).toMatchObject({
      usedTokens: 900,
    });
  });

  it("falls back to prompt + generated when the runtime reports no cache counter", () => {
    expect(measureContextUsage({ promptTokens: 700, generatedTokens: 50 }, 1000, 0.8)).toMatchObject({ usedTokens: 750 });
  });

  it("measures nothing when there is nothing to measure", () => {
    expect(measureContextUsage(undefined, 1000, 0.8)).toBeUndefined();
    expect(measureContextUsage({ promptTokens: 700 }, 1000, 0.8)).toBeUndefined();
    expect(measureContextUsage({ cacheTokens: 700 }, 0, 0.8)).toBeUndefined();
  });
});
