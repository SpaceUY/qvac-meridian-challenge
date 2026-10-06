/** One session's KV cache on disk: the `<kvCacheKey>/` folder the SDK writes for `kvCache: sessionId`. */
export interface SessionCacheEntry {
  key: string;
  bytes: number;
  /** Newest modification time found inside the folder - the last turn that wrote to it. */
  lastUsedMs: number;
}

export interface SessionCacheRetentionPolicy {
  /** Evicted once idle for at least this long. */
  maxIdleMs: number;
  /** Never evicted while idle for less than this, not even to honor `maxTotalBytes` - protects a conversation that is still in use. */
  minIdleMs: number;
  /** Least-recently-used entries are evicted until the total fits. */
  maxTotalBytes: number;
}

/** Outcome of one sweep. `skipped` is set when nothing was even listed. */
export interface SessionCacheSweepReport {
  scanned: number;
  evicted: string[];
  failed: string[];
  freedBytes: number;
  skipped?: "not-ready" | "already-running" | "inventory-failed";
}
