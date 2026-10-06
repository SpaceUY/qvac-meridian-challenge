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
