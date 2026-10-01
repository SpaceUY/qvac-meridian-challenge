import { describe, expect, it } from "vitest";
import { isCancellationError } from "../../models/domain/errors.js";
import { ConcurrencyLimiter } from "./concurrencyLimiter.js";

/** Enough microtask ticks for a suspended async function to run up to its next real wait. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

describe("ConcurrencyLimiter.acquire", () => {
  it("admits immediately while under the limit", async () => {
    const limiter = new ConcurrencyLimiter(2);

    const release = await limiter.acquire("a");

    expect(typeof release).toBe("function");
    expect(limiter.activeCount).toBe(1);
    expect(limiter.queuedCount).toBe(0);
  });

  it("queues a request once the limit is reached", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire("a");

    let admitted = false;
    const pending = limiter.acquire("b").then((release) => {
      admitted = true;
      return release;
    });
    await flushMicrotasks();

    expect(admitted).toBe(false);
    expect(limiter.queuedCount).toBe(1);
    void pending;
  });

  it("admits a queued request once a slot frees, in FIFO order", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const releaseA = await limiter.acquire("a");
    const order: string[] = [];
    const pendingB = limiter.acquire("b").then((release) => {
      order.push("b");
      return release;
    });
    const pendingC = limiter.acquire("c").then((release) => {
      order.push("c");
      return release;
    });
    await flushMicrotasks();
    expect(order).toEqual([]);

    releaseA();
    const releaseB = await pendingB;
    expect(order).toEqual(["b"]);
    expect(limiter.activeCount).toBe(1);
    expect(limiter.queuedCount).toBe(1);

    releaseB();
    await pendingC;
    expect(order).toEqual(["b", "c"]);
  });

  it("admits a third request once two of two active slots free, at a limit of 2", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const releaseA = await limiter.acquire("a");
    await limiter.acquire("b");

    let admitted = false;
    const pendingC = limiter.acquire("c").then((release) => {
      admitted = true;
      return release;
    });
    await flushMicrotasks();
    expect(admitted).toBe(false);

    releaseA();
    await pendingC;
    expect(admitted).toBe(true);
  });

  it("rejects a second acquire() for a key already queued, instead of silently stranding the first caller forever", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire("a");

    const firstQueued = limiter.acquire("b");
    await flushMicrotasks();

    await expect(limiter.acquire("b")).rejects.toThrow(/already queued/i);
    // The first "b" caller must still be resolvable once a slot frees - it
    // must not have been silently overwritten/orphaned by the rejected call.
    expect(limiter.queuedCount).toBe(1);
    void firstQueued;
  });

  it("rejects a second acquire() for a key already active, instead of silently clobbering the caller's bookkeeping for it", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const releaseA = await limiter.acquire("a");

    await expect(limiter.acquire("a")).rejects.toThrow(/already active/i);
    expect(limiter.activeCount).toBe(1);
    void releaseA;
  });

  it("rejects admission once the queue is at its depth cap, instead of growing unbounded", async () => {
    const limiter = new ConcurrencyLimiter(1, 2);
    await limiter.acquire("active");
    const queuedA = limiter.acquire("a");
    const queuedB = limiter.acquire("b");
    await flushMicrotasks();
    expect(limiter.queuedCount).toBe(2);

    await expect(limiter.acquire("c")).rejects.toThrow(/queue (is )?full|queue depth/i);
    expect(limiter.queuedCount).toBe(2);
    void queuedA;
    void queuedB;
  });
});

describe("ConcurrencyLimiter.cancel", () => {
  it("rejects a queued acquire() with a cancellation error, without ever admitting it", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await limiter.acquire("a");
    const pendingB = limiter.acquire("b");
    await flushMicrotasks();

    const cancelled = limiter.cancel("b");

    expect(cancelled).toBe(true);
    const error = await pendingB.catch((err: unknown) => err);
    expect(isCancellationError(error) || (error as Error)?.name === "OperationCancelledError").toBe(true);
    expect(limiter.queuedCount).toBe(0);
  });

  it("does not affect another queued request when one is cancelled", async () => {
    const limiter = new ConcurrencyLimiter(1);
    const releaseA = await limiter.acquire("a");
    const pendingB = limiter.acquire("b");
    const pendingC = limiter.acquire("c").then((release) => {
      release();
      return "done";
    });
    await flushMicrotasks();

    limiter.cancel("b");
    releaseA();

    await expect(pendingC).resolves.toBe("done");
    await expect(pendingB).rejects.toThrow();
  });

  it("is a no-op (returns false) for an unknown key", () => {
    const limiter = new ConcurrencyLimiter(1);
    expect(limiter.cancel("unknown")).toBe(false);
  });

  it("is a no-op (returns false) for a key that is already active, not queued", async () => {
    const limiter = new ConcurrencyLimiter(2);
    await limiter.acquire("a");

    expect(limiter.cancel("a")).toBe(false);
    expect(limiter.activeCount).toBe(1);
  });
});
