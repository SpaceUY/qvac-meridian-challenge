/**
 * Locates the EmbeddingGemma GGUF file `@qvac/sdk` already downloaded into
 * its file cache, and the default config the native worker loads it with.
 *
 * Originally lived in the I.4 spike
 * (`experiments/native-embed-spike/nativeEmbedClient.ts`) and was imported
 * from there by `NativeEmbeddingProvider` - moved here because that made
 * real production code depend on a folder named for a throwaway spike. The
 * spike now imports this file instead (see its own `nativeEmbedClient.ts`),
 * not the other way around.
 *
 * I.4 LIMITATION, intentionally not generalized: this always resolves
 * EmbeddingGemma 300M Q4_0. `NativeEmbeddingProvider` ignores the
 * `modelSource`/`batchSize` that `ResilientEmbeddingService` otherwise
 * threads through to the SDK fallback (`QvacEmbeddingService` can load any
 * registry model; the native path here cannot). Making the native path
 * model-agnostic is out of scope for I.4 - see
 * `docs/i4-native-addon-results.md`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDINGGEMMA_300M_Q4_0 } from '@qvac/sdk';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `src/rag/infra/nativeEmbedding` -> `src` -> `backend` -> `apps` -> repo root. */
const backendDir = path.resolve(moduleDir, '..', '..', '..', '..');
const repoRoot = path.resolve(backendDir, '..', '..');
const QVAC_CACHE_DIR = path.join(repoRoot, '.qvac-cache');

/**
 * Same defaults `@qvac/sdk`'s `EMBED_CONFIG_DEFAULTS` applies for this model
 * (`config/models.config.ts`'s `EMBEDDING_MODEL_SOURCE` sets no
 * `engineConfig` override, so the SDK's own schema defaults - `device:
 * 'gpu'`, `gpuLayers: 99`, `batchSize: 1024` - are what actually load it
 * today), translated to the native addon's string-keyed config contract the
 * same way the SDK's `llamacpp-embedding/plugin.js` (`transformEmbedConfig`)
 * does.
 */
export const DEFAULT_NATIVE_EMBED_CONFIG: Record<string, string> = {
  device: 'gpu',
  gpu_layers: '99',
  batch_size: '1024'
};

/**
 * Locates the EmbeddingGemma GGUF file `@qvac/sdk` already downloaded into
 * its file cache (`npm run models:fetch` / `npm run corpus:ingest`).
 * Matches by the catalog's own filename + `expectedSize`
 * (`EMBEDDINGGEMMA_300M_Q4_0`, the same `@qvac/sdk` constant
 * `config/models.config.ts` reads for `registryPath`/`registrySource`)
 * rather than reimplementing the cache's content-hash filename prefix.
 */
export function resolveEmbeddingGemmaModelPath(): string {
  const filename = path.basename(EMBEDDINGGEMMA_300M_Q4_0.registryPath);
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
  if (size !== EMBEDDINGGEMMA_300M_Q4_0.expectedSize) {
    throw new Error(
      `Cached model at ${fullPath} is ${size} bytes, expected ${EMBEDDINGGEMMA_300M_Q4_0.expectedSize} - possibly corrupt or a different quantization.`
    );
  }
  return fullPath;
}
