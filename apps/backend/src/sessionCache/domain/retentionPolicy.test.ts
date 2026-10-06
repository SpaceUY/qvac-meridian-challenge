import { describe, expect, it } from "vitest";
import { planSessionCacheEvictions } from "./retentionPolicy.js";
import type { SessionCacheEntry, SessionCacheRetentionPolicy } from "./types.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_000 * HOUR;
const POLICY: SessionCacheRetentionPolicy = { maxIdleMs: 24 * HOUR, minIdleMs: 15 * MINUTE, maxTotalBytes: 1_000 };

function entry(key: string, idleMs: number, bytes = 100): SessionCacheEntry {
  return { key, bytes, lastUsedMs: NOW - idleMs };
}
const keys = (entries: SessionCacheEntry[]) => entries.map((e) => e.key);

describe("planSessionCacheEvictions", () => {
  it("evicts nothing when every entry is recent and the total fits", () => {
    expect(planSessionCacheEvictions([entry("a", HOUR), entry("b", 2 * HOUR)], POLICY, NOW)).toEqual([]);
  });

  it("evicts entries idle for at least maxIdleMs, boundary included", () => {
    const plan = planSessionCacheEvictions([entry("old", 24 * HOUR), entry("older", 48 * HOUR), entry("fresh", HOUR)], POLICY, NOW);
    expect(keys(plan)).toEqual(["older", "old"]);
  });

  it("evicts least-recently-used entries until the total fits the byte cap", () => {
    const plan = planSessionCacheEvictions(
      [entry("newest", HOUR, 400), entry("oldest", 3 * HOUR, 400), entry("middle", 2 * HOUR, 400)],
      POLICY,
      NOW,
    );
    expect(keys(plan)).toEqual(["oldest"]);
  });

  it("does not count expired entries twice toward the byte cap", () => {
    const plan = planSessionCacheEvictions([entry("expired", 30 * HOUR, 5_000), entry("kept", HOUR, 500)], POLICY, NOW);
    expect(keys(plan)).toEqual(["expired"]);
  });

  it("never evicts an entry used within minIdleMs, even over the byte cap", () => {
    const plan = planSessionCacheEvictions([entry("active", 5 * MINUTE, 5_000), entry("idle", HOUR, 10)], POLICY, NOW);
    expect(keys(plan)).toEqual(["idle"]);
  });

  it("treats a lastUsedMs in the future (clock skew) as just used", () => {
    expect(planSessionCacheEvictions([entry("skewed", -HOUR, 5_000)], POLICY, NOW)).toEqual([]);
  });

  it("orders equally old entries by key so the plan is deterministic", () => {
    const plan = planSessionCacheEvictions([entry("b", 30 * HOUR), entry("a", 30 * HOUR)], POLICY, NOW);
    expect(keys(plan)).toEqual(["a", "b"]);
  });

  it("returns an empty plan for no entries", () => {
    expect(planSessionCacheEvictions([], POLICY, NOW)).toEqual([]);
  });
});
