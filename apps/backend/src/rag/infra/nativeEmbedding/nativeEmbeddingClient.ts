/**
 * Node-side client for the persistent native embedding worker (`bare/embedServer.js`). Spawns
 * `bare.exe` once and exchanges newline-delimited JSON over a named pipe - same IPC shape
 * `@qvac/sdk` uses internally, without its RPC/plugin/schema layer.
 */
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import bareSpawn from "bare-runtime/spawn";
import type { ChildProcess } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT_PATH = path.join(scriptDir, "bare", "embedServer.js");

const DEFAULT_INIT_TIMEOUT_MS = 60_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000;

export interface NativeEmbedResult {
  embedding: number[];
  stats: Record<string, unknown> | null;
}

/** Thrown for any failure of the native worker - initialization failure, a crashed/exited process, or a socket error. Callers (the fallback layer) key off this type, not message text. */
export class NativeWorkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeWorkerError";
  }
}

interface PendingRequest {
  resolve: (results: NativeEmbedResult[]) => void;
  reject: (err: Error) => void;
}

function createPipePath(): string {
  const suffix = `qvac-native-embed-${process.pid}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
  return process.platform === "win32" ? `\\\\.\\pipe\\${suffix}` : path.join(os.tmpdir(), `${suffix}.sock`);
}

function unlinkSocketBestEffort(pipePath: string): void {
  if (process.platform === "win32") return; // Windows named pipes aren't filesystem paths.
  try {
    if (fs.existsSync(pipePath)) fs.unlinkSync(pipePath);
  } catch {
    // best-effort cleanup only
  }
}

/** Shared "settle exactly once" guard for `start()`/`shutdown()`, each of which has several completion paths that must resolve their promise exactly once. */
function settleOnceWithTimeout(timeoutMs: number, onTimeout: () => void): { settle: (fn: () => void) => void } {
  let settled = false;
  const timer = setTimeout(() => {
    if (settled) return;
    settled = true;
    onTimeout();
  }, timeoutMs);

  return {
    settle(fn: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    }
  };
}

/** Manages one persistent `bare.exe` worker. Once crashed, every call rejects with `NativeWorkerError` - this class never restarts itself; that policy belongs to the caller. */
export class NativeEmbeddingClient {
  private server: net.Server | null = null;
  private socket: net.Socket | null = null;
  private child: ChildProcess | null = null;
  private pipePath: string | null = null;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private crashed = false;
  private shuttingDown = false;

  async start(modelPath: string, config: Record<string, string>, initTimeoutMs = DEFAULT_INIT_TIMEOUT_MS): Promise<void> {
    const pipePath = createPipePath();
    this.pipePath = pipePath;

    await new Promise<void>((resolve, reject) => {
      const { settle } = settleOnceWithTimeout(initTimeoutMs, () => {
        this.teardownAfterFailure();
        reject(new NativeWorkerError(`native embed worker did not become ready within ${initTimeoutMs}ms`));
      });
      const settleResolve = (): void => settle(resolve);
      const settleReject = (err: Error): void =>
        settle(() => {
          this.teardownAfterFailure();
          reject(err);
        });

      const server = net.createServer((socket) => {
        this.socket = socket;
        this.wireSocket(socket, settleResolve, settleReject);
      });
      this.server = server;

      server.on("error", (err) => settleReject(new NativeWorkerError(`native embed worker pipe server error: ${err.message}`)));

      server.listen(pipePath, () => {
        try {
          const child = bareSpawn({
            args: [WORKER_SCRIPT_PATH, pipePath, modelPath, JSON.stringify(config)],
            stdio: ["ignore", "inherit", "inherit"]
          });
          this.child = child;
          // Windows doesn't kill child processes when the parent exits - without this, a crashed
          // shutdown path would leak a live bare.exe (mirrors @qvac/sdk's own exit-handler kill).
          process.once("exit", () => {
            try {
              if (!child.killed) child.kill();
            } catch {
              // best-effort only - the process is already tearing down
            }
          });
          child.on("error", (err) => settleReject(new NativeWorkerError(`failed to spawn native embed worker: ${err.message}`)));
          child.on("exit", (code, signal) => {
            const wasExpected = this.shuttingDown;
            this.crashed = !wasExpected;
            if (!wasExpected) {
              const err = new NativeWorkerError(`native embed worker exited unexpectedly (code=${code}, signal=${signal})`);
              settleReject(err);
              this.rejectAllPending(err);
            }
          });
        } catch (err) {
          settleReject(new NativeWorkerError(`failed to spawn native embed worker: ${err instanceof Error ? err.message : String(err)}`));
        }
      });
    });
  }

  private wireSocket(
    socket: net.Socket,
    onReady: () => void,
    onInitError: (err: NativeWorkerError) => void
  ): void {
    socket.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        this.handleLine(line, onReady, onInitError);
      }
    });

    socket.on("error", (err) => {
      const wrapped = new NativeWorkerError(`native embed worker pipe socket error: ${err.message}`);
      onInitError(wrapped);
      if (!this.shuttingDown) {
        this.crashed = true;
        this.rejectAllPending(wrapped);
      }
    });
  }

  private handleLine(line: string, onReady: () => void, onInitError: (err: NativeWorkerError) => void): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      return; // Malformed line from the worker - ignore rather than crash the client over a logging glitch.
    }

    if (message.type === "ready") {
      onReady();
      return;
    }
    if (message.type === "initError") {
      onInitError(new NativeWorkerError(`native embed worker failed to load the model: ${String(message.error)}`));
      return;
    }

    const id = typeof message.id === "number" ? message.id : null;
    if (id === null) return;
    const pendingRequest = this.pending.get(id);
    if (!pendingRequest) return;
    this.pending.delete(id);

    if (message.ok) {
      pendingRequest.resolve((message.results as NativeEmbedResult[]) ?? []);
    } else {
      pendingRequest.reject(new NativeWorkerError(`native embed request failed: ${String(message.error)}`));
    }
  }

  private rejectAllPending(err: Error): void {
    for (const { reject } of this.pending.values()) reject(err);
    this.pending.clear();
  }

  private teardownAfterFailure(): void {
    try {
      this.child?.kill();
    } catch {
      // best-effort
    }
    try {
      this.server?.close();
    } catch {
      // best-effort
    }
    if (this.pipePath) unlinkSocketBestEffort(this.pipePath);
  }

  async embedMany(texts: string[]): Promise<NativeEmbedResult[]> {
    if (this.crashed) {
      throw new NativeWorkerError("native embed worker has crashed; this client will not serve further requests");
    }
    if (!this.socket) {
      throw new NativeWorkerError("native embed worker is not connected");
    }

    const id = this.nextId++;
    return new Promise<NativeEmbedResult[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.write(JSON.stringify({ id, type: "embed", texts }) + "\n");
    });
  }

  /** True once the worker has exited unexpectedly or its pipe errored - the caller should stop using this client and fail over. */
  get isCrashed(): boolean {
    return this.crashed;
  }

  async shutdown(timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (this.crashed || !this.child || !this.socket) {
      this.teardownAfterFailure();
      return;
    }

    this.shuttingDown = true;
    const child = this.child;

    await new Promise<void>((resolve) => {
      const { settle } = settleOnceWithTimeout(timeoutMs, () => {
        try {
          child.kill();
        } catch {
          // best-effort
        }
        resolve();
      });
      const finish = (): void => settle(resolve);

      child.once("exit", finish);

      const id = this.nextId++;
      try {
        this.socket!.write(JSON.stringify({ id, type: "shutdown" }) + "\n");
      } catch {
        finish();
      }
    });

    try {
      this.server?.close();
    } catch {
      // best-effort
    }
    if (this.pipePath) unlinkSocketBestEffort(this.pipePath);
  }
}
