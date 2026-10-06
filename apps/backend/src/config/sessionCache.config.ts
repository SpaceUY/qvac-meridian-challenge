import os from "node:os";
import path from "node:path";
import type { SessionCacheRetentionPolicy } from "../sessionCache/domain/types.js";

/** Where `@qvac/sdk` 0.18.2 keeps KV caches: `getQvacPath('kv-cache')` = `$HOME/.qvac/kv-cache`. Not moved by `cacheDirectory` in `qvac.config.mjs` - that one only relocates model weights. */
export const SESSION_CACHE_DIR = path.join(os.homedir(), ".qvac", "kv-cache");

/** 24 h idle and 4 GiB mirror the SDK's own limits for auto caches (`kv-cache-session.js`), so both kinds of cache follow the same rules. 15 min protects a conversation that is still open. */
export const SESSION_CACHE_RETENTION_POLICY: SessionCacheRetentionPolicy = {
  maxIdleMs: 24 * 60 * 60 * 1000,
  minIdleMs: 15 * 60 * 1000,
  maxTotalBytes: 4 * 1024 * 1024 * 1024,
};

/** First sweep shortly after startup (a sweep is skipped until the chat model is ready), then hourly. */
export const SESSION_CACHE_SWEEP_SCHEDULE = { initialDelayMs: 60 * 1000, intervalMs: 60 * 60 * 1000 };
