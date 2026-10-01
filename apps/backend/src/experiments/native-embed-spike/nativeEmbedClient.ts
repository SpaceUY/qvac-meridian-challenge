/**
 * I.4 spike - Node-side glue for the alternative embedding path:
 *
 *   RAG -> nativeEmbedClient (this file) -> bare process -> @qvac/embed-llamacpp -> C++ engine
 *
 * instead of the existing:
 *
 *   RAG -> @qvac/sdk (embed()) -> bare worker (RPC) -> @qvac/embed-llamacpp -> C++ engine
 *
 * `@qvac/embed-llamacpp`'s native binding (`binding.js`: `module.exports =
 * require.addon()`) only loads under the Bare runtime, never under Node -
 * so this module never requires the addon itself. It spawns a `bare`
 * process (via `bare-runtime/spawn`, the same resolver `@qvac/sdk` uses
 * internally to launch its own worker - see `node-rpc-client.js`) running
 * `bare/embedWorker.js`, and talks to it over two temp JSON files instead
 * of `@qvac/sdk`'s RPC/plugin/schema layer. No `@qvac/sdk` runtime call
 * (`loadModel`, `embed`, etc.) appears anywhere in this file.
 *
 * `DEFAULT_NATIVE_EMBED_CONFIG`/`resolveEmbeddingGemmaModelPath` are
 * re-exported from `rag/infra/nativeEmbedding/embeddingGemmaModel.ts` (their
 * canonical home, since production code needs them too) rather than defined
 * here - kept as re-exports so `benchmark.ts`/`verifyVectorStore.ts` don't
 * need to change their imports.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import bareSpawn from "bare-runtime/spawn";
import type { ModelSource } from "../../models/domain/types.js";
import { DEFAULT_NATIVE_EMBED_CONFIG, resolveEmbeddingGemmaModelPath } from "../../rag/infra/nativeEmbedding/embeddingGemmaModel.js";

export { DEFAULT_NATIVE_EMBED_CONFIG, resolveEmbeddingGemmaModelPath };

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const WORKER_SCRIPT_PATH = path.join(scriptDir, "bare", "embedWorker.js");

export interface NativeEmbedCall {
  elapsedMs: number;
  embedding: number[];
  stats: Record<string, unknown> | null;
}

export interface NativeEmbedResult {
  loadTimeMs: number;
  calls: NativeEmbedCall[];
}

/**
 * `EMBEDDING_MODEL_SOURCE` (`config/models.config.ts`) is a plain data
 * constant, always `{ kind: 'registry', ... }` in practice, but typed as the
 * broader `ModelSource` union - narrows the same way
 * `models/infra/qvacRuntimeAdapter.ts`'s own `toModelSrc()` does.
 */
export function toRegistryModelSrc(source: ModelSource): string {
  if (source.kind !== "registry") {
    throw new Error(`expected a registry ModelSource, got kind="${source.kind}"`);
  }
  return `registry://${source.registrySource}/${source.registryPath}`;
}

export interface RunNativeEmbeddingsOptions {
  config?: Record<string, string>;
  /** Invoked with the spawned bare worker's PID as soon as it starts, e.g. for RSS sampling. */
  onSpawn?: (pid: number) => void;
}

/**
 * Runs `texts` through `@qvac/embed-llamacpp` directly inside one spawned
 * `bare` process. One process per call: loads the model once, embeds every
 * text in order (so only the first call pays model-load cost), unloads,
 * then exits.
 */
export async function runNativeEmbeddings(
  modelPath: string,
  texts: string[],
  options: RunNativeEmbeddingsOptions = {}
): Promise<NativeEmbedResult> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "qvac-native-embed-"));
  const requestPath = path.join(workDir, `request-${randomUUID()}.json`);
  const responsePath = path.join(workDir, `response-${randomUUID()}.json`);
  fs.writeFileSync(
    requestPath,
    JSON.stringify({ modelPath, config: options.config ?? DEFAULT_NATIVE_EMBED_CONFIG, texts })
  );

  try {
    await new Promise<void>((resolve, reject) => {
      const child = bareSpawn({
        args: [WORKER_SCRIPT_PATH, requestPath, responsePath],
        stdio: ["ignore", "inherit", "inherit"]
      });
      if (child.pid !== undefined) options.onSpawn?.(child.pid);
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`native embed worker (bare) exited with code ${code}`));
      });
    });

    const raw = fs.readFileSync(responsePath, "utf8");
    const parsed = JSON.parse(raw) as NativeEmbedResult | { error: string; stack?: string };
    if ("error" in parsed) {
      throw new Error(`native embed worker failed: ${parsed.error}`);
    }
    return parsed;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
