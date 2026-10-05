/**
 * I.4 spike - Node-side glue for the native embedding path: RAG -> nativeEmbedClient -> bare process -> @qvac/embed-llamacpp -> C++ engine (vs. the existing RAG -> @qvac/sdk -> bare worker (RPC) -> @qvac/embed-llamacpp).
 * `@qvac/embed-llamacpp`'s native binding only loads under Bare, never Node - this spawns a `bare` process (`bare/embedWorker.js`) and talks to it via two temp JSON files instead of `@qvac/sdk`'s RPC layer.
 * `DEFAULT_NATIVE_EMBED_CONFIG`/`resolveEmbeddingGemmaModelPath` are re-exported from their production home (`rag/infra/nativeEmbedding/embeddingGemmaModel.ts`) so `benchmark.ts`/`verifyVectorStore.ts` don't need to change imports.
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

/** `EMBEDDING_MODEL_SOURCE` is always `{ kind: 'registry', ... }` in practice but typed as the broader `ModelSource` union - narrows the same way `qvacRuntimeAdapter.ts`'s `toModelSrc()` does. */
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

/** Runs `texts` through `@qvac/embed-llamacpp` in one spawned `bare` process: loads the model once, embeds everything in order, unloads, exits. */
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
