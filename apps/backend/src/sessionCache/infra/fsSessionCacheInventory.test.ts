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
      // "junction" keeps this working on Windows without elevated privileges (plain symlinks need
      // SeCreateSymbolicLinkPrivilege there); junctions are reported identically by lstat/readdir.
      await symlink(outside, path.join(root, UUID_A, "m", "link"), "junction");

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
