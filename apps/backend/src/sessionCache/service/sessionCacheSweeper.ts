import type { SessionCacheInventoryPort, SessionCacheRemover } from "../domain/ports.js";
import { planSessionCacheEvictions } from "../domain/retentionPolicy.js";
import type { SessionCacheEntry, SessionCacheRetentionPolicy, SessionCacheSweepReport } from "../domain/types.js";

const LOG_PREFIX = "[session-cache:sweep]";

export interface SessionCacheSweeperOptions {
  /** Sweeps only run while this is true - an SDK call during a model load can break the shared RPC connection. */
  isReady: () => boolean;
  now?: () => number;
}

/** Deletes idle per-session KV caches the SDK never evicts on its own (it only sweeps `kvCache: true` auto keys). Never throws: a failed sweep is logged and retried on the next tick. */
export class SessionCacheSweeper {
  private running = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly inventory: SessionCacheInventoryPort,
    private readonly remover: SessionCacheRemover,
    private readonly policy: SessionCacheRetentionPolicy,
    private readonly options: SessionCacheSweeperOptions,
  ) {}

  async sweep(): Promise<SessionCacheSweepReport> {
    if (!this.options.isReady()) return emptyReport("not-ready");
    if (this.running) return emptyReport("already-running");
    this.running = true;
    try {
      return await this.runSweep();
    } finally {
      this.running = false;
    }
  }

  /** Fire-and-forget schedule. Timers are unref'd so they never keep the process alive. Call once, at server startup. */
  start(schedule: { initialDelayMs: number; intervalMs: number }): void {
    if (this.timers.length > 0) return;
    const tick = () => void this.sweep();
    this.timers = [setTimeout(tick, schedule.initialDelayMs), setInterval(tick, schedule.intervalMs)];
    for (const timer of this.timers) timer.unref();
  }

  stop(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }

  private async runSweep(): Promise<SessionCacheSweepReport> {
    let entries: SessionCacheEntry[];
    try {
      entries = await this.inventory.list();
    } catch (err) {
      console.error(`${LOG_PREFIX} could not list session caches`, err);
      return emptyReport("inventory-failed");
    }
    const report: SessionCacheSweepReport = { scanned: entries.length, evicted: [], failed: [], freedBytes: 0 };
    const nowMs = (this.options.now ?? Date.now)();
    for (const entry of planSessionCacheEvictions(entries, this.policy, nowMs)) {
      try {
        await this.remover.deleteSessionCache(entry.key);
        report.evicted.push(entry.key);
        report.freedBytes += entry.bytes;
      } catch (err) {
        report.failed.push(entry.key);
        console.error(`${LOG_PREFIX} could not delete session ${entry.key}`, err);
      }
    }
    if (report.evicted.length > 0 || report.failed.length > 0) {
      console.log(`${LOG_PREFIX} scanned ${report.scanned}, evicted ${report.evicted.length} (${report.freedBytes} bytes), failed ${report.failed.length}`);
    }
    return report;
  }
}

function emptyReport(skipped: NonNullable<SessionCacheSweepReport["skipped"]>): SessionCacheSweepReport {
  return { scanned: 0, evicted: [], failed: [], freedBytes: 0, skipped };
}
