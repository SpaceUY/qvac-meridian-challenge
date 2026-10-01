import { readFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
const pidFile = join(backendDir, ".run", "server.pid");

if (!existsSync(pidFile)) {
  console.log("[serve:stop] no pid file, nothing to stop");
  process.exit(0);
}

const pid = Number(readFileSync(pidFile, "utf8").trim());

function isAlive(targetPid) {
  try {
    process.kill(targetPid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Negative pid = the whole process GROUP serve.mjs's `detached: true` made this process the leader of, not just this one pid - see serve.mjs's comment on why that matters. */
function killGroup(targetPid, signal) {
  try {
    process.kill(-targetPid, signal);
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
  }
}

killGroup(pid, "SIGTERM");
console.log(`[serve:stop] sent SIGTERM to process group ${pid}`);

// server.ts's own shutdown handler self-bounds at ~4s (3s cleanup timeout +
// 1s fallback, see its SHUTDOWN_CLEANUP_TIMEOUT_MS) - 5s here is a safety
// margin above that, not an arbitrary guess. If it's still alive past this,
// something hung and SIGKILL is the honest fallback rather than leaving an
// orphaned process the next `npm run serve` would collide with on port 3001.
const deadline = Date.now() + 5000;
while (isAlive(pid) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (isAlive(pid)) {
  console.log(`[serve:stop] pid ${pid} still alive after 5s, sending SIGKILL`);
  killGroup(pid, "SIGKILL");
}

rmSync(pidFile, { force: true });
console.log("[serve:stop] done");
