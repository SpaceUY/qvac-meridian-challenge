import { OperationCancelledError } from "../domain/errors.js";

interface Waiter {
  resolve: (release: () => void) => void;
  reject: (err: unknown) => void;
}

/**
 * Default cap on queued (not-yet-admitted) callers, independent of the
 * concurrency `limit` itself - without this, slow/stuck clients could queue
 * an unbounded number of waiters (unbounded memory, arbitrarily long wait
 * times). 64 mirrors `@qvac/sdk`'s own request-registry admission policy
 * (`maxQueueDepthPerModel`), which bounds the exact same kind of queue for
 * the exact same `completion`/`parallel` concurrency mechanism server-side.
 */
const DEFAULT_MAX_QUEUE_DEPTH = 64;

/**
 * Bounds how many callers can hold a slot at once; callers past the limit
 * queue FIFO until one releases. Backs per-tier continuous-batching
 * concurrency (see I.2's spike/results doc) - `limit: 1` reproduces today's
 * sequential behavior exactly, just through an explicit queue instead of a
 * scalar race.
 */
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
   * Resolves with a `release()` function once a slot is free - immediately
   * if under the limit, otherwise once an earlier holder (or an earlier
   * queued caller, in FIFO order) releases. Rejects with an
   * `OperationCancelledError` if `cancel(key)` fires first, without ever
   * admitting the caller.
   *
   * Rejects immediately if `key` is already active or already queued -
   * `activeKeys`/`waiters`/`queueOrder` are all keyed by `key`, so a second
   * call reusing the same one would silently clobber the first's bookkeeping
   * (an early, premature `release()` for the wrong holder, or a waiter left
   * stranded forever) instead of failing loudly. Not expected in practice
   * (every caller mints a fresh id per call), but cheap to guard against a
   * permanent hang or a leaked slot.
   *
   * Also rejects immediately once `queuedCount` is already at
   * `maxQueueDepth` - the queue is backpressure, not unbounded storage; a
   * caller past the cap should see a clear rejection now instead of waiting
   * indefinitely behind an ever-growing line.
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

  /**
   * Cancels a still-queued `acquire(key)`, rejecting it without ever
   * admitting it. No-op (returns `false`) when `key` is unknown or already
   * admitted - only a queued caller can be cancelled this way.
   */
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
