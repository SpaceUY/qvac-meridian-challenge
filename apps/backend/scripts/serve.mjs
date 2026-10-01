import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, openSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const runDir = join(backendDir, ".run");
mkdirSync(runDir, { recursive: true });
const pidFile = join(runDir, "server.pid");
const logFile = join(runDir, "server.log");

/**
 * The LOCAL tsx binary (already present after `npm ci` - it's a
 * devDependency), not `npx tsx`: npx's own resolution step is one more
 * moving part that has no reason to run during a phase this product
 * promises is network-free, and spawning through npx would add an extra
 * process layer between this script and the actual server process, which
 * complicates `serve-stop.mjs` killing the right thing (see below).
 *
 * Walks up from `backendDir` the same way Node's own module resolution
 * would, because this is an npm-workspaces monorepo: npm hoists a
 * devDependency shared across workspaces (tsx is only declared in
 * `apps/backend/package.json`, but nothing else here needs its own copy)
 * up to the repo root's `node_modules/.bin/`, not this workspace's own -
 * `apps/backend/node_modules/.bin/tsx` doesn't exist on disk even right
 * after `npm ci`. Still never falls back to `npx` if neither is found;
 * that's a broken install, not something to paper over.
 */
function resolveTsxBin() {
  let dir = backendDir;
  for (;;) {
    const candidate = join(dir, "node_modules", ".bin", "tsx");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find the local tsx binary by walking up from ${backendDir} - run "npm ci" first.`,
      );
    }
    dir = parent;
  }
}

const tsxBin = resolveTsxBin();
const logFd = openSync(logFile, "a");

const child = spawn(tsxBin, ["src/server.ts"], {
  cwd: backendDir,
  // `detached: true` makes this child the leader of its OWN process group
  // (pgid === its own pid) - that's what lets serve-stop.mjs signal the
  // whole group (`process.kill(-pid, ...)`) instead of just this one pid,
  // so a subprocess this spawns (e.g. @qvac/sdk's own worker process,
  // documented elsewhere in this codebase as sharing its parent's process
  // group) goes down too, not left orphaned.
  detached: true,
  stdio: ["ignore", logFd, logFd],
  env: process.env,
});
child.unref();
writeFileSync(pidFile, String(child.pid));
console.log(`[serve] started pid ${child.pid}, logs at ${logFile}`);
