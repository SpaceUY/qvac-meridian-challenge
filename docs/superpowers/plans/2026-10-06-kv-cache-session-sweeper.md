# KV Cache Session Sweeper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound the on-disk size of per-session KV caches (`~/.qvac/kv-cache/<sessionId>/`) by periodically evicting idle sessions, without changing any existing behavior.

**Architecture:** A new self-contained `sessionCache` module, split like `models/` and `rag/` (`domain` / `infra` / `service`). A pure retention policy decides *what* to evict; a filesystem inventory adapter reports *what exists*; a sweeper service schedules the two and deletes through the **existing** `AgentService.deleteSessionCache()` path (the same one "New chat" uses). Only `server.ts` (the composition root) is modified.

**Tech Stack:** TypeScript (NodeNext ESM, `strict`), Node `fs/promises`, Vitest, `@qvac/sdk` `0.18.2` (via the existing `deleteCache` port only).

**Spec:** Option 2 ("barrido propio") of the KV-cache analysis in this session: the SDK only sweeps *auto* keys (`kvCache: true`, `.auto-cache-<16hex>` markers - `node_modules/@qvac/sdk/dist/server/bare/ops/kv-cache-retention.js`); string keys (`kvCache: sessionId`, set in `qvacRuntimeAdapter.ts:186`) are never evicted, and the only cleanup today is `DELETE /api/chat/sessions/:sessionId/cache` on "New chat".

## Global Constraints

- `@qvac/sdk` stays pinned at `0.18.2`. No new dependencies.
- No new direct `@qvac/sdk` import: deletion goes through `AgentService.deleteSessionCache()` → `ModelManagementService.deleteCache()` → `QvacRuntimeAdapter.deleteCache()`. Deleting through the SDK (not `fs.rm`) keeps the worker's in-memory cache registries (`initializedCaches`, `cachedPrefixes` in `kv-cache-session.js`) consistent.
- Only directories whose name matches the existing `SESSION_ID_PATTERN` (UUID, `chat/chat.router.const.ts:18`) are ever candidates. SDK auto caches and anything else in the folder are never touched.
- Open/closed: no existing class or function changes signature. The only edit to existing code is wiring in `apps/backend/src/server.ts`.
- A sweep failure never crashes or blocks the server: every error is caught and logged with the `[session-cache:sweep]` prefix.
- No sweep while the chat model is not `"ready"` (an SDK RPC during a model load reproducibly broke the shared connection with "SDK is shutting down" in an earlier audit).
- Timers are `unref()`'d so they never keep Node alive (CLAUDE.md: the process must be able to exit).
- No commits to `main`. Work happens on branch `feat/kv-cache-sweeper` in worktree `.claude/worktrees/kv-cache-sweeper`.

## Design decisions (and rejected alternatives)

| Decision | Chosen | Rejected, and when it would be right |
|---|---|---|
| How to know what exists | Read `~/.qvac/kv-cache` directly (the SDK has no list API) | An SDK list call - right once the SDK exposes one; then only `FsSessionCacheInventory` is swapped (DIP) |
| How to delete | Existing `deleteSessionCache()` → SDK `deleteCache({ kvCacheKey })` | `fs.rm` - simpler, but leaves the worker's in-memory registries pointing at deleted files |
| "Last used" | Newest `mtime` of any file/dir inside the session folder | Folder `mtime` alone - unreliable: the SDK writes into `<sessionId>/<modelId>/`, which does not bump the top folder's `mtime` |
| In-flight protection | `minIdleMs` (15 min): nothing used that recently is ever evicted, not even by the byte cap | Tracking in-flight session ids - exact, but needs shared mutable state across `AgentService`; not worth it when a turn takes minutes at most |
| Byte cap | Yes, evicting least-recently-used first | Age only - one long session can still reach GBs |
| Where `SESSION_ID_PATTERN` comes from | Injected as an `isSessionKey` predicate in `server.ts` | Importing `chat/` from `sessionCache/` - couples a lower-level module to the HTTP layer |

## File Structure

| File | Responsibility |
|---|---|
| Create `apps/backend/src/config/sessionCache.config.ts` | Tunables: folder path, idle/byte limits, schedule |
| Create `apps/backend/src/sessionCache/domain/types.ts` | `SessionCacheEntry`, `SessionCacheRetentionPolicy`, `SessionCacheSweepReport` |
| Create `apps/backend/src/sessionCache/domain/ports.ts` | `SessionCacheInventoryPort`, `SessionCacheRemover` |
| Create `apps/backend/src/sessionCache/domain/retentionPolicy.ts` | Pure `planSessionCacheEvictions()` |
| Create `apps/backend/src/sessionCache/infra/fsSessionCacheInventory.ts` | Lists session folders with size and last use |
| Create `apps/backend/src/sessionCache/service/sessionCacheSweeper.ts` | Gate, re-entrancy guard, delete loop, report, timers |
| Modify `apps/backend/src/server.ts` | Compose and start; stop in `shutdown()` |
| Tests next to each file (`*.test.ts`), as in the rest of `apps/backend/src` | |

---

### Task 1: Domain types, ports, and the pure retention policy

**Files:**
- Create: `apps/backend/src/sessionCache/domain/types.ts`
- Create: `apps/backend/src/sessionCache/domain/ports.ts`
- Create: `apps/backend/src/sessionCache/domain/retentionPolicy.ts`
- Test: `apps/backend/src/sessionCache/domain/retentionPolicy.test.ts`

**Interfaces:**
- Produces: `SessionCacheEntry { key: string; bytes: number; lastUsedMs: number }`, `SessionCacheRetentionPolicy { maxIdleMs: number; minIdleMs: number; maxTotalBytes: number }`, `SessionCacheSweepReport`, `SessionCacheInventoryPort { list(): Promise<SessionCacheEntry[]> }`, `SessionCacheRemover { deleteSessionCache(sessionId: string): Promise<void> }`, `planSessionCacheEvictions(entries, policy, nowMs): SessionCacheEntry[]`.

- [ ] **Step 1: Write the types and ports**

```ts
// domain/types.ts
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
```

```ts
// domain/ports.ts
import type { SessionCacheEntry } from "./types.js";

/** Lists every session KV cache that currently exists. Implemented over the filesystem today because `@qvac/sdk` has no list API. */
export interface SessionCacheInventoryPort {
  list(): Promise<SessionCacheEntry[]>;
}

/** Same shape as `AgentService.deleteSessionCache`, so the sweeper deletes through the exact path "New chat" uses. */
export interface SessionCacheRemover {
  deleteSessionCache(sessionId: string): Promise<void>;
}
```

- [ ] **Step 2: Write the failing policy tests** (`retentionPolicy.test.ts`)

```ts
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
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd apps/backend && npx vitest run src/sessionCache/domain/retentionPolicy.test.ts`
Expected: FAIL - cannot find module `./retentionPolicy.js`.

- [ ] **Step 4: Implement** (`retentionPolicy.ts`)

```ts
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
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd apps/backend && npx vitest run src/sessionCache/domain/retentionPolicy.test.ts`
Expected: PASS (8 tests).

---

### Task 2: Filesystem inventory adapter

**Files:**
- Create: `apps/backend/src/sessionCache/infra/fsSessionCacheInventory.ts`
- Test: `apps/backend/src/sessionCache/infra/fsSessionCacheInventory.test.ts`

**Interfaces:**
- Consumes: `SessionCacheInventoryPort`, `SessionCacheEntry` (Task 1).
- Produces: `class FsSessionCacheInventory implements SessionCacheInventoryPort`, constructor `(rootDir: string, isSessionKey: (name: string) => boolean)`.

- [ ] **Step 1: Write the failing tests** (real temp dirs; `fs.utimes` controls `mtime`)

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FsSessionCacheInventory } from "./fsSessionCacheInventory.js";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const isUuid = (name: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name);

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "session-cache-inventory-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeCacheFile(relativePath: string, bytes: number, mtimeSec: number): Promise<void> {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.alloc(bytes));
  await utimes(filePath, mtimeSec, mtimeSec);
}

describe("FsSessionCacheInventory", () => {
  it("returns an empty list when the cache folder does not exist yet", async () => {
    const inventory = new FsSessionCacheInventory(path.join(root, "missing"), isUuid);
    expect(await inventory.list()).toEqual([]);
  });

  it("sums nested file sizes and takes the newest mtime as lastUsedMs", async () => {
    await writeCacheFile(`${UUID_A}/model-1/aaaa.bin`, 300, 1_000);
    await writeCacheFile(`${UUID_A}/model-1/bbbb.bin`, 200, 5_000);
    await utimes(path.join(root, UUID_A, "model-1"), 10, 10);
    await utimes(path.join(root, UUID_A), 10, 10);

    const [entry] = await new FsSessionCacheInventory(root, isUuid).list();
    expect(entry).toEqual({ key: UUID_A, bytes: 500, lastUsedMs: 5_000_000 });
  });

  it("ignores folders and files whose name is not a session key", async () => {
    await writeCacheFile(`${UUID_B}/m/x.bin`, 10, 100);
    await writeCacheFile("sess-run1/m/x.bin", 10, 100);
    await writeCacheFile("0123456789abcdef/m/x.bin", 10, 100);
    await writeFile(path.join(root, ".auto-cache-0123456789abcdef"), "");

    const entries = await new FsSessionCacheInventory(root, isUuid).list();
    expect(entries.map((e) => e.key)).toEqual([UUID_B]);
  });

  it("does not follow symlinks out of the cache folder", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "session-cache-outside-"));
    try {
      await writeFile(path.join(outside, "big.bin"), Buffer.alloc(1_000));
      await writeCacheFile(`${UUID_A}/m/real.bin`, 10, 100);
      await symlink(outside, path.join(root, UUID_A, "m", "link"));

      const [entry] = await new FsSessionCacheInventory(root, isUuid).list();
      expect(entry?.bytes).toBe(10);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("propagates errors other than a missing root folder", async () => {
    const notADir = path.join(root, "file");
    await writeFile(notADir, "x");
    await expect(new FsSessionCacheInventory(notADir, isUuid).list()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/backend && npx vitest run src/sessionCache/infra/fsSessionCacheInventory.test.ts`
Expected: FAIL - cannot find module.

- [ ] **Step 3: Implement** (`fsSessionCacheInventory.ts`)

```ts
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import type { SessionCacheInventoryPort } from "../domain/ports.js";
import type { SessionCacheEntry } from "../domain/types.js";

interface FolderUsage {
  bytes: number;
  lastUsedMs: number;
}

/** Reads the SDK's KV-cache folder directly - `@qvac/sdk` 0.18.2 has no API to list cache keys. Layout (`kv-cache-utils.js`): `<root>/<kvCacheKey>/<modelId>/<configHash>.bin`. Only top-level folders accepted by `isSessionKey` are reported, so SDK auto caches are never candidates. */
export class FsSessionCacheInventory implements SessionCacheInventoryPort {
  constructor(
    private readonly rootDir: string,
    private readonly isSessionKey: (name: string) => boolean,
  ) {}

  async list(): Promise<SessionCacheEntry[]> {
    const names = await this.readRootOrEmpty();
    const entries: SessionCacheEntry[] = [];
    for (const name of names) {
      if (!this.isSessionKey(name)) continue;
      const usage = await measureFolder(path.join(this.rootDir, name));
      if (usage) entries.push({ key: name, ...usage });
    }
    return entries;
  }

  private async readRootOrEmpty(): Promise<string[]> {
    try {
      return await readdir(this.rootDir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }
  }
}

/** Total size and newest mtime under `folderPath`. Symlinks are not followed. `undefined` if it vanished mid-scan (e.g. "New chat" deleted it). */
async function measureFolder(folderPath: string): Promise<FolderUsage | undefined> {
  try {
    const stats = await lstat(folderPath);
    if (!stats.isDirectory()) return undefined;
    const usage: FolderUsage = { bytes: 0, lastUsedMs: stats.mtimeMs };
    for (const child of await readdir(folderPath, { withFileTypes: true })) {
      const childPath = path.join(folderPath, child.name);
      if (child.isDirectory()) {
        const nested = await measureFolder(childPath);
        if (nested) addUsage(usage, nested);
      } else if (child.isFile()) {
        const fileStats = await lstat(childPath);
        addUsage(usage, { bytes: fileStats.size, lastUsedMs: fileStats.mtimeMs });
      }
    }
    return usage;
  } catch (err) {
    if (isNotFound(err)) return undefined;
    throw err;
  }
}

function addUsage(target: FolderUsage, source: FolderUsage): void {
  target.bytes += source.bytes;
  target.lastUsedMs = Math.max(target.lastUsedMs, source.lastUsedMs);
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT";
}
```

Note: the "newest mtime" test sets folder `mtime` to 10 s so the 5 000 s file is the max - this is what proves the file, not the folder, drives `lastUsedMs`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/backend && npx vitest run src/sessionCache/infra/fsSessionCacheInventory.test.ts`
Expected: PASS (5 tests).

---

### Task 3: Sweeper service

**Files:**
- Create: `apps/backend/src/sessionCache/service/sessionCacheSweeper.ts`
- Test: `apps/backend/src/sessionCache/service/sessionCacheSweeper.test.ts`

**Interfaces:**
- Consumes: Task 1 types/ports and `planSessionCacheEvictions`.
- Produces: `class SessionCacheSweeper` with `sweep(): Promise<SessionCacheSweepReport>`, `start(schedule: { initialDelayMs: number; intervalMs: number }): void`, `stop(): void`; constructor `(inventory: SessionCacheInventoryPort, remover: SessionCacheRemover, policy: SessionCacheRetentionPolicy, options: SessionCacheSweeperOptions)`, where `SessionCacheSweeperOptions { isReady: () => boolean; now?: () => number }`.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/backend && npx vitest run src/sessionCache/service/sessionCacheSweeper.test.ts`
Expected: FAIL - cannot find module.

- [ ] **Step 3: Implement** (`sessionCacheSweeper.ts`)

```ts
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
```

`clearTimeout` also clears an interval in Node (same timer pool), so one loop handles both.

- [ ] **Step 4: Run to verify it passes**

Run: `cd apps/backend && npx vitest run src/sessionCache/service/sessionCacheSweeper.test.ts`
Expected: PASS (8 tests).

---

### Task 4: Config and composition-root wiring

**Files:**
- Create: `apps/backend/src/config/sessionCache.config.ts`
- Modify: `apps/backend/src/server.ts` (imports; after `readiness.start()`; inside `shutdown()`)

**Interfaces:**
- Consumes: `FsSessionCacheInventory` (Task 2), `SessionCacheSweeper` (Task 3), existing `AgentService.deleteSessionCache` / `AgentService.getStatus`, existing `SESSION_ID_PATTERN`.

- [ ] **Step 1: Write the config**

```ts
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
```

- [ ] **Step 2: Wire in `server.ts`**

Imports (with the other imports):

```ts
import { SESSION_ID_PATTERN } from "./chat/chat.router.const.js";
import {
  SESSION_CACHE_DIR,
  SESSION_CACHE_RETENTION_POLICY,
  SESSION_CACHE_SWEEP_SCHEDULE,
} from "./config/sessionCache.config.js";
import { FsSessionCacheInventory } from "./sessionCache/infra/fsSessionCacheInventory.js";
import { SessionCacheSweeper } from "./sessionCache/service/sessionCacheSweeper.js";
```

Right after `readiness.start();`:

```ts
// Per-session KV caches (`kvCache: sessionId`) are never evicted by the SDK; "New chat" only frees the one being left. This bounds the rest (closed tabs, API clients, crashes).
const sessionCacheSweeper = new SessionCacheSweeper(
  new FsSessionCacheInventory(SESSION_CACHE_DIR, (name) => SESSION_ID_PATTERN.test(name)),
  agentService,
  SESSION_CACHE_RETENTION_POLICY,
  { isReady: () => agentService.getStatus().status === "ready" },
);
sessionCacheSweeper.start(SESSION_CACHE_SWEEP_SCHEDULE);
```

First line of the `shutdown()` body after the re-entry guard (`shuttingDown = true;`):

```ts
  sessionCacheSweeper.stop();
```

- [ ] **Step 3: Type-check both configs**

Run: `cd apps/backend && npx tsc -p tsconfig.json --noEmit && npx tsc -p tsconfig.build.json --noEmit`
Expected: no output, exit 0.

---

### Task 5: Full verification (no regressions)

- [ ] **Step 1:** Root suite: `npm test` from the repo root. Expected: everything that passes on `main` still passes, plus the 21 new tests. Run the same command on `main` first to get the baseline count.
- [ ] **Step 2:** Production build: `npm run build:server` and `npm run build:client`. Expected: both succeed.
- [ ] **Step 3:** Real-folder dry run (read-only): run `FsSessionCacheInventory` + `planSessionCacheEvictions` against the real `~/.qvac/kv-cache` and print the plan without deleting. Expected: only UUID folders listed; total matches `du`; plan = folders idle > 24 h.
- [ ] **Step 4:** Live app: start the backend + frontend, wait for `/health` ready, run a multi-turn chat in the UI, "New chat", and an OpenAI-style `/v1/chat/completions` call with `X-Meridian-Session`. Expected: same behavior as `main`; no `[session-cache:sweep]` errors in the log.
- [ ] **Step 5:** Sweep end-to-end against a throwaway session: create a session through the API, backdate its folder's mtimes (`touch -t`), trigger a sweep (short `initialDelayMs` via a one-off script calling `sweeper.sweep()` against a live `AgentService`, or by temporarily lowering the delay), and confirm the folder is gone and the server keeps answering on that session id (it re-primes a fresh cache).
- [ ] **Step 6:** Commit only if the user asks (project rule: never on `main`; this is `feat/kv-cache-sweeper`).
