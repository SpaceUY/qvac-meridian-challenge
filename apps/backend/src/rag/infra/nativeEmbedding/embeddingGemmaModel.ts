/**
 * Locates a model's GGUF file in `@qvac/sdk`'s own file cache, and the
 * default config the native worker loads it with.
 *
 * Originally lived in the I.4 spike
 * (`experiments/native-embed-spike/nativeEmbedClient.ts`) and was imported
 * from there by `NativeEmbeddingProvider` - moved here because that made
 * real production code depend on a folder named for a throwaway spike. The
 * spike now imports this file instead (see its own `nativeEmbedClient.ts`),
 * not the other way around.
 *
 * Generalized from the original I.4 EmbeddingGemma-only resolver so
 * `NativeEmbeddingProvider` can be pointed at any `ModelSource`
 * (`resolveNativeEmbeddingModelPath`) instead of always resolving
 * EmbeddingGemma 300M Q4_0. `resolveEmbeddingGemmaModelPath()` below is kept
 * as a thin wrapper, unchanged in behavior, purely so the I.4 spike scripts
 * (`experiments/native-embed-spike/*`), which specifically benchmark
 * EmbeddingGemma, don't need to change.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDINGGEMMA_300M_Q4_0 } from '@qvac/sdk';
import type { ModelSource } from '../../../models/domain/types.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `src/rag/infra/nativeEmbedding` -> `src` -> `backend` -> `apps` -> repo root. */
const backendDir = path.resolve(moduleDir, '..', '..', '..', '..');
const repoRoot = path.resolve(backendDir, '..', '..');
const QVAC_CACHE_DIR = path.join(repoRoot, '.qvac-cache');

/**
 * Same defaults `@qvac/sdk`'s `EMBED_CONFIG_DEFAULTS` applies (neither
 * EmbeddingGemma nor BGE-M3's `ModelSource` in `config/models.config.ts`
 * sets an `engineConfig` override, so the SDK's own schema defaults -
 * `device: 'gpu', gpuLayers: 99, batchSize: 1024` - are what actually load
 * either model today), translated to the native addon's string-keyed config
 * contract the same way the SDK's `llamacpp-embedding/plugin.js`
 * (`transformEmbedConfig`) does.
 */
export const DEFAULT_NATIVE_EMBED_CONFIG: Record<string, string> = {
  device: 'gpu',
  gpu_layers: '99',
  batch_size: '1024'
};

/**
 * The filename `@qvac/sdk`'s cache matches against for a given source - the
 * basename of its `registryPath` (registry sources) or the basename of its
 * URL's path (url sources). `rawSrc` has no stable filename to key off, so
 * it isn't supported here (the native embedding path never uses it).
 */
function cacheFilenameFor(source: ModelSource): string {
  if (source.kind === 'registry') return path.basename(source.registryPath);
  if (source.kind === 'url') return path.basename(new URL(source.url).pathname);
  throw new Error(`native embedding path cannot resolve a cache filename for ModelSource kind="${source.kind}"`);
}

/**
 * Locates `source`'s GGUF file in `@qvac/sdk`'s file cache (populated by
 * `npm run models:fetch` / `npm run corpus:ingest`). Matches by the source's
 * own filename (`cacheFilenameFor`) + `expectedSize`, rather than
 * reimplementing the cache's content-hash filename prefix - the same check
 * `resolveEmbeddingGemmaModelPath()` below used to do inline for
 * EmbeddingGemma specifically, generalized to take the source and its
 * expected size as arguments instead of assuming both.
 */
export function resolveNativeEmbeddingModelPath(source: ModelSource, expectedSize: number): string {
  const filename = cacheFilenameFor(source);
  if (!fs.existsSync(QVAC_CACHE_DIR)) {
    throw new Error(
      `QVAC cache directory not found at ${QVAC_CACHE_DIR}. Run "npm run models:fetch" or "npm run corpus:ingest" first.`
    );
  }
  const match = fs.readdirSync(QVAC_CACHE_DIR).find((entry) => entry.endsWith(`_${filename}`) || entry === filename);
  if (!match) {
    throw new Error(
      `Could not find a cached "${filename}" under ${QVAC_CACHE_DIR}. Run "npm run models:fetch" or "npm run corpus:ingest" first.`
    );
  }
  const fullPath = path.join(QVAC_CACHE_DIR, match);
  const { size } = fs.statSync(fullPath);
  if (size !== expectedSize) {
    throw new Error(
      `Cached model at ${fullPath} is ${size} bytes, expected ${expectedSize} - possibly corrupt or a different quantization.`
    );
  }
  return fullPath;
}

/** Back-compat wrapper for the I.4 spike scripts (`experiments/native-embed-spike/*`), which specifically benchmark EmbeddingGemma 300M Q4_0 and nothing else. */
export function resolveEmbeddingGemmaModelPath(): string {
  return resolveNativeEmbeddingModelPath(
    {
      kind: 'registry',
      registryPath: EMBEDDINGGEMMA_300M_Q4_0.registryPath,
      registrySource: EMBEDDINGGEMMA_300M_Q4_0.registrySource
    },
    EMBEDDINGGEMMA_300M_Q4_0.expectedSize
  );
}
