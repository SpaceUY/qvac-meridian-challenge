import type { SessionCacheEntry, SessionCacheRetentionPolicy } from "./types.js";

/** Decides which session caches to delete, oldest first. Pure: no I/O and no clock, so every rule is unit-testable. */
export function planSessionCacheEvictions(
  entries: readonly SessionCacheEntry[],
  policy: SessionCacheRetentionPolicy,
  nowMs: number,
): SessionCacheEntry[] {
  const idleMs = (entry: SessionCacheEntry) => nowMs - entry.lastUsedMs;
  const oldestFirst = [...entries].sort((a, b) => a.lastUsedMs - b.lastUsedMs || a.key.localeCompare(b.key));

  const expired = oldestFirst.filter((entry) => idleMs(entry) >= policy.maxIdleMs);
  const remaining = oldestFirst.filter((entry) => idleMs(entry) < policy.maxIdleMs);

  let remainingBytes = remaining.reduce((total, entry) => total + entry.bytes, 0);
  const overCap: SessionCacheEntry[] = [];
  for (const entry of remaining) {
    if (remainingBytes <= policy.maxTotalBytes) break;
    if (idleMs(entry) < policy.minIdleMs) continue;
    overCap.push(entry);
    remainingBytes -= entry.bytes;
  }
  return [...expired, ...overCap];
}
