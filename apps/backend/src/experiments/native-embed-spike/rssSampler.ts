/**
 * Peak-RSS sampler for the `bare.exe` process(es) holding the loaded GGUF weights, for BOTH benchmark paths - `@qvac/sdk` spawns its own `bare` worker too, so `process.memoryUsage().rss` of the Node driver would only capture the thin RPC client, not the model.
 * Windows-only (see `docs/i4-native-addon-results.md` for the Linux/macOS equivalent).
 * IMPORTANT: uses `cmd.exe /c tasklist`, not PowerShell - an earlier version shelled out to `powershell.exe` synchronously on a 100ms `setInterval`; a single `powershell.exe` call costs ~300ms here (vs ~90ms for `tasklist`) and blocked Node's entire event loop, including the RPC callback resolving `embed()` - which is what actually produced the false ~600ms/call latency in the first draft of `docs/i4-native-addon-results.md`, not a real `@qvac/sdk` cost (see that doc's "correction" section). This version uses async, non-overlapping `execFile` so sampling can't distort the latency it's measuring alongside.
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

/** Waits until no `bare.exe` is running (polling) so the benchmark's two phases never overlap in the RSS sample - `close()`/exit is async from the caller's view. Gives up after `timeoutMs` rather than hanging forever. */
export async function waitForNoBareProcesses(timeoutMs = 10_000, pollIntervalMs = 150): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((await sampleBareWorkingSetBytes()) > 0) {
    if (Date.now() > deadline) return;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/** Self-rescheduling via `setTimeout` (not `setInterval`) so samples never overlap or queue - each tick's `execFile` yields the event loop for its whole duration. */
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
