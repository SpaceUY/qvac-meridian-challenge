import { OperationCancelledError } from "../../models/domain/errors.js";

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
}

/** Cap on queued (not-yet-admitted) callers, so a stuck client can't queue unbounded waiters — mirrors `@qvac/sdk`'s own `maxQueueDepthPerModel` for the same `completion`/`parallel` mechanism. */
const DEFAULT_MAX_QUEUE_DEPTH = 64;

/** Bounds concurrent callers per key, FIFO queue beyond that; `limit: 1` reproduces today's sequential behavior explicitly (see I.2's spike/results doc). */
export class ConcurrencyLimiter {
  private active = 0;
  private readonly activeKeys = new Set<string>();
  private readonly waiters = new Map<string, Waiter>();
  private readonly queueOrder: string[] = [];

  constructor(
    private readonly limit: number,
    private readonly maxQueueDepth: number = DEFAULT_MAX_QUEUE_DEPTH,
  ) {}

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queueOrder.length;
  }

  /**
   * Resolves with `release()` once a slot is free (FIFO); rejects with `OperationCancelledError` if `cancel(key)` fires first.
   * Also rejects immediately on a duplicate `key` (would silently clobber the first call's bookkeeping) or once the queue is already at `maxQueueDepth`.
   */
  acquire(key: string): Promise<() => void> {
    if (this.activeKeys.has(key)) {
      return Promise.reject(new Error(`ConcurrencyLimiter: a request with key "${key}" is already active`));
    }
    if (this.active < this.limit) {
      this.active += 1;
      this.activeKeys.add(key);
      return Promise.resolve(() => this.release(key));
    }
    if (this.waiters.has(key)) {
      return Promise.reject(new Error(`ConcurrencyLimiter: a request with key "${key}" is already queued`));
    }
    if (this.queueOrder.length >= this.maxQueueDepth) {
      return Promise.reject(
        new Error(`ConcurrencyLimiter: queue depth cap (${this.maxQueueDepth}) reached - queue is full`),
      );
    }
    return new Promise<() => void>((resolve, reject) => {
      this.waiters.set(key, { resolve, reject });
      this.queueOrder.push(key);
    });
  }

  /** Cancels a still-queued `acquire(key)`; no-op (`false`) if `key` is unknown or already admitted. */
  cancel(key: string): boolean {
    const waiter = this.waiters.get(key);
    if (!waiter) return false;
    this.waiters.delete(key);
    const index = this.queueOrder.indexOf(key);
    if (index !== -1) this.queueOrder.splice(index, 1);
    waiter.reject(new OperationCancelledError(key));
    return true;
  }

  private release(key: string): void {
    this.active -= 1;
    this.activeKeys.delete(key);
    const nextKey = this.queueOrder.shift();
    if (nextKey === undefined) return;
    const waiter = this.waiters.get(nextKey);
    this.waiters.delete(nextKey);
    this.active += 1;
    this.activeKeys.add(nextKey);
    waiter?.resolve(() => this.release(nextKey));
  }
}
