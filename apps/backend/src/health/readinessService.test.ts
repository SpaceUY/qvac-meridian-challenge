import { describe, expect, it, vi } from "vitest";
import { ReadinessService, type ChatReadinessSource, type EmbeddingReadinessSource } from "./readinessService.js";

function fakeChat(initial: "idle" | "loading" | "ready" | "error"): ChatReadinessSource & { preloadCallCount: number } {
  let status = initial;
  return {
    preloadCallCount: 0,
    getStatus: () => ({ status }),
    async preload() {
      this.preloadCallCount += 1;
      status = "ready";
    },
  };
}

function fakeEmbedding(behavior: "resolves" | "rejects-once-then-resolves" | "always-rejects"): EmbeddingReadinessSource & { callCount: number } {
  let calls = 0;
  return {
    callCount: 0,
    async embed(_text: string) {
      this.callCount += 1;
      calls += 1;
      if (behavior === "always-rejects") throw new Error("embedding down");
      if (behavior === "rejects-once-then-resolves" && calls === 1) throw new Error("transient");
      return [0.1, 0.2];
    },
  };
}

describe("ReadinessService.check()", () => {
  it("is not ready while the chat model is still loading", () => {
    const readiness = new ReadinessService(fakeChat("loading"), fakeEmbedding("resolves"));
    const result = readiness.check();
    expect(result.ready).toBe(false);
    expect(result.chatStatus).toBe("loading");
  });

  it("is not ready while the embedding warm-up promise is still in flight", async () => {
    const embedding = fakeEmbedding("resolves");
    const readiness = new ReadinessService(fakeChat("ready"), embedding);
    const first = readiness.check();
    expect(first.ready).toBe(false);
    expect(first.embeddingReady).toBe(false);
    await vi.waitFor(() => expect(readiness.check().embeddingReady).toBe(true));
  });

  it("is ready once both the chat model and the embedding model are warm", async () => {
    const readiness = new ReadinessService(fakeChat("ready"), fakeEmbedding("resolves"));
    await vi.waitFor(() => expect(readiness.check().ready).toBe(true));
  });

  it("retries a preload that previously ended in error", async () => {
    const chat = fakeChat("error");
    const readiness = new ReadinessService(chat, fakeEmbedding("resolves"));
    readiness.check();
    expect(chat.preloadCallCount).toBe(1);
    await vi.waitFor(() => expect(readiness.check().chatStatus).toBe("ready"));
  });

  it("does not start a second embedding warm-up while one is already in flight", () => {
    const embedding = fakeEmbedding("resolves");
    const readiness = new ReadinessService(fakeChat("ready"), embedding);
    readiness.check();
    readiness.check();
    readiness.check();
    expect(embedding.callCount).toBe(1);
  });

  it("clears the failed warm-up promise so the next check() retries instead of hanging on a rejected promise forever", async () => {
    const embedding = fakeEmbedding("rejects-once-then-resolves");
    const readiness = new ReadinessService(fakeChat("ready"), embedding);
    readiness.check();
    await vi.waitFor(() => expect(embedding.callCount).toBe(1));
    await vi.waitFor(() => expect(readiness.check().ready).toBe(true));
    expect(embedding.callCount).toBe(2);
  });
});

describe("ReadinessService.start()", () => {
  it("kicks off both the chat preload and the embedding warm-up without waiting for either", () => {
    const chat = fakeChat("idle");
    const embedding = fakeEmbedding("resolves");
    const readiness = new ReadinessService(chat, embedding);
    readiness.start();
    expect(chat.preloadCallCount).toBe(1);
    expect(embedding.callCount).toBe(1);
  });
});
