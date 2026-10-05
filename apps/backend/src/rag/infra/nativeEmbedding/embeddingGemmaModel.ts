/**
 * Locates a model's GGUF file in `@qvac/sdk`'s file cache, plus the default config the native
 * worker loads it with. Moved out of `experiments/native-embed-spike/` so production code doesn't
 * depend on a spike folder - the spike now imports from here instead.
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

/** Same defaults as `@qvac/sdk`'s `EMBED_CONFIG_DEFAULTS`, translated to the native addon's string-keyed config contract. */
export const DEFAULT_NATIVE_EMBED_CONFIG: Record<string, string> = {
  device: 'gpu',
  gpu_layers: '99',
  batch_size: '1024'
};

/** The filename `@qvac/sdk`'s cache matches against: basename of `registryPath` or the URL's path. `rawSrc` has no stable filename, so it's unsupported here. */
function cacheFilenameFor(source: ModelSource): string {
  if (source.kind === 'registry') return path.basename(source.registryPath);
  if (source.kind === 'url') return path.basename(new URL(source.url).pathname);
  throw new Error(`native embedding path cannot resolve a cache filename for ModelSource kind="${source.kind}"`);
}

/** Locates `source`'s GGUF file in `@qvac/sdk`'s file cache (populated by `npm run models:fetch`/`corpus:ingest`), matching by filename + `expectedSize`. */
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

/** Back-compat wrapper for the I.4 spike scripts, which benchmark EmbeddingGemma 300M Q4_0 specifically. */
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
