import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCacheSweeper } from "./sessionCacheSweeper.js";
import type { SessionCacheInventoryPort, SessionCacheRemover } from "../domain/ports.js";
import type { SessionCacheEntry, SessionCacheRetentionPolicy } from "../domain/types.js";

const HOUR = 3_600_000;
const NOW = 1_000 * HOUR;
const POLICY: SessionCacheRetentionPolicy = { maxIdleMs: 24 * HOUR, minIdleMs: 0, maxTotalBytes: Number.MAX_SAFE_INTEGER };
const OLD: SessionCacheEntry = { key: "old", bytes: 300, lastUsedMs: NOW - 48 * HOUR };
const FRESH: SessionCacheEntry = { key: "fresh", bytes: 100, lastUsedMs: NOW - HOUR };

function fakeInventory(entries: SessionCacheEntry[] | Error): SessionCacheInventoryPort & { calls: number } {
  return {
    calls: 0,
    async list() {
      this.calls += 1;
      if (entries instanceof Error) throw entries;
      return entries;
    },
  };
}

function fakeRemover(failingKeys: string[] = []): SessionCacheRemover & { deleted: string[] } {
  return {
    deleted: [],
    async deleteSessionCache(sessionId: string) {
      if (failingKeys.includes(sessionId)) throw new Error(`cannot delete ${sessionId}`);
      this.deleted.push(sessionId);
    },
  };
}

function makeSweeper(inventory: SessionCacheInventoryPort, remover: SessionCacheRemover, isReady = () => true) {
  return new SessionCacheSweeper(inventory, remover, POLICY, { isReady, now: () => NOW });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("SessionCacheSweeper.sweep()", () => {
  it("deletes only what the policy selects and reports freed bytes", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const remover = fakeRemover();
    const report = await makeSweeper(fakeInventory([OLD, FRESH]), remover).sweep();
    expect(remover.deleted).toEqual(["old"]);
    expect(report).toEqual({ scanned: 2, evicted: ["old"], failed: [], freedBytes: 300 });
  });

  it("skips without listing while the chat model is not ready", async () => {
    const inventory = fakeInventory([OLD]);
    const report = await makeSweeper(inventory, fakeRemover(), () => false).sweep();
    expect(inventory.calls).toBe(0);
    expect(report.skipped).toBe("not-ready");
  });

  it("keeps going when one delete fails, and reports it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const second: SessionCacheEntry = { ...OLD, key: "old-2", lastUsedMs: OLD.lastUsedMs + 1 };
    const remover = fakeRemover(["old"]);
    const report = await makeSweeper(fakeInventory([OLD, second]), remover).sweep();
    expect(remover.deleted).toEqual(["old-2"]);
    expect(report.failed).toEqual(["old"]);
    expect(report.freedBytes).toBe(300);
  });

  it("never rejects when the inventory fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const report = await makeSweeper(fakeInventory(new Error("EACCES")), fakeRemover()).sweep();
    expect(report.skipped).toBe("inventory-failed");
    expect(errorSpy).toHaveBeenCalledWith("[session-cache:sweep] could not list session caches", expect.any(Error));
  });

  it("does not run two sweeps at the same time", async () => {
    let release!: () => void;
    const inventory: SessionCacheInventoryPort = {
      list: () => new Promise((resolve) => { release = () => resolve([]); }),
    };
    const sweeper = makeSweeper(inventory, fakeRemover());
    const first = sweeper.sweep();
    const second = await sweeper.sweep();
    expect(second.skipped).toBe("already-running");
    release();
    expect((await first).skipped).toBeUndefined();
  });

  it("logs nothing when there is nothing to evict", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await makeSweeper(fakeInventory([FRESH]), fakeRemover()).sweep();
    expect(logSpy).not.toHaveBeenCalled();
  });
});

describe("SessionCacheSweeper.start()/stop()", () => {
  it("sweeps after the initial delay and then on every interval, until stopped", async () => {
    vi.useFakeTimers();
    const inventory = fakeInventory([]);
    const sweeper = makeSweeper(inventory, fakeRemover());
    sweeper.start({ initialDelayMs: 1_000, intervalMs: 10_000 });

    await vi.advanceTimersByTimeAsync(999);
    expect(inventory.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(inventory.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(inventory.calls).toBe(2);

    sweeper.stop();
    await vi.advanceTimersByTimeAsync(50_000);
    expect(inventory.calls).toBe(2);
  });

  it("ignores a second start() instead of doubling the timers", async () => {
    vi.useFakeTimers();
    const inventory = fakeInventory([]);
    const sweeper = makeSweeper(inventory, fakeRemover());
    sweeper.start({ initialDelayMs: 1_000, intervalMs: 10_000 });
    sweeper.start({ initialDelayMs: 1_000, intervalMs: 10_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(inventory.calls).toBe(1);
    sweeper.stop();
  });
});
