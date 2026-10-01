/**
 * Peak-RSS sampler for the `bare.exe` process(es) that actually hold the
 * loaded GGUF weights - for BOTH benchmark paths. `@qvac/sdk` spawns its own
 * `bare` worker per model (see `node-rpc-client.js`'s `ensureRPC()`), so the
 * SDK path's real memory cost lives in a separate `bare.exe` process just
 * like the native path's does; `process.memoryUsage().rss` of the Node/tsx
 * driver script would only capture the thin RPC client, not the model.
 *
 * Windows-only - this spike only runs on this dev machine (see
 * `docs/i4-native-addon-results.md` for the Linux/macOS equivalent this
 * would need, e.g. reading `/proc/<pid>/status`).
 *
 * IMPORTANT: uses `cmd.exe /c tasklist`, NOT PowerShell. An earlier version
 * of this file shelled out to `powershell.exe -Command "Get-Process ..."`
 * via `execFileSync` on a 100ms `setInterval`. On this machine a single
 * `powershell.exe` invocation costs ~300ms (likely AMSI/script-scanning
 * overhead - `cmd.exe /c tasklist` for the same information costs ~90ms) -
 * and because `execFileSync` is SYNCHRONOUS, that 300ms call blocked
 * Node's entire event loop, including the socket callback that resolves a
 * pending `@qvac/sdk` `embed()` RPC call. Sampling every 100ms while that
 * call itself takes ~300ms meant the event loop was blocked almost
 * continuously for the whole benchmark, which is what actually produced the
 * ~600ms/call `embed()` latency reported in the first version of
 * `docs/i4-native-addon-results.md` - not a real `@qvac/sdk` cost. See that
 * doc's "correction" section for the full story. This version uses async,
 * non-blocking `execFile` on a self-rescheduling `setTimeout` (never
 * overlapping calls, never blocking the loop) specifically so sampling
 * memory cannot distort the very latency numbers being measured alongside
 * it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface RssSampler {
  /** Stops sampling and returns the peak combined `bare.exe` working set observed, in bytes (0 if none was ever seen running). */
  stop(): Promise<number>;
}

/** `tasklist /FO CSV /NH` row shape: `"bare.exe","19684","Console","1","31,812 KB"` - memory is the last field, locale-formatted (thousands separator varies), always in KB. */
function parseCsvMemoryKb(line: string): number | null {
  const fields = line.split(",");
  const memField = fields.at(-1);
  if (!memField) return null;
  const digitsOnly = memField.replace(/[^\d]/g, "");
  if (!digitsOnly) return null;
  return Number(digitsOnly);
}

async function sampleBareWorkingSetBytes(): Promise<number> {
  try {
    const { stdout } = await execFileAsync("cmd.exe", ["/c", "tasklist", "/FI", "IMAGENAME eq bare.exe", "/FO", "CSV", "/NH"], {
      encoding: "utf8",
      timeout: 5000
    });
    let totalKb = 0;
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.toLowerCase().includes('"bare.exe"')) continue;
      const kb = parseCsvMemoryKb(line);
      if (kb !== null) totalKb += kb;
    }
    return totalKb * 1024;
  } catch {
    // Sampling is best-effort: a transient failure should not fail the benchmark.
    return 0;
  }
}

/**
 * Waits until no `bare.exe` process is running (polling), so the benchmark's
 * two phases never overlap in the RSS sample - `close()`/process exit is
 * asynchronous from the caller's point of view. Resolves immediately if none
 * are running. Gives up after `timeoutMs` rather than hanging forever on a
 * process that failed to exit.
 */
export async function waitForNoBareProcesses(timeoutMs = 10_000, pollIntervalMs = 150): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((await sampleBareWorkingSetBytes()) > 0) {
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Self-rescheduling (via `setTimeout` after each sample resolves, not
 * `setInterval`) so samples never overlap and never queue up - each tick's
 * async `execFile` call yields the event loop for its whole duration.
 */
export function startBareRssSampler(intervalMs = 150): RssSampler {
  let peakBytes = 0;
  let stopped = false;
  let pendingSample: Promise<void> = Promise.resolve();

  const tick = (): void => {
    if (stopped) return;
    pendingSample = sampleBareWorkingSetBytes().then((bytes) => {
      if (bytes > peakBytes) peakBytes = bytes;
      if (!stopped) setTimeout(tick, intervalMs);
    });
  };
  tick();

  return {
    async stop(): Promise<number> {
      stopped = true;
      await pendingSample;
      return peakBytes;
    }
  };
}
