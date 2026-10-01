// @qvac/sdk config for this workspace. A .mjs file (not .json) so the cache
// path is computed relative to this file's own location instead of being
// hardcoded per developer machine - portable across clones/OSes/drives.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(backendDir, '..', '..');

export default {
  cacheDirectory: path.join(repoRoot, '.qvac-cache'),
  // Off by default in the SDK (stream loggers disable console output
  // unless told otherwise) - turned on here so a delegated vs. local
  // loadModel() call is visible in this workspace's own terminal output
  // (`npm run dev:server` and `npm run provider` both read this file).
  // See apps/backend/README.md § Delegated inference (P2P) > Verifying
  // delegation.
  loggerLevel: 'info',
  loggerConsoleOutput: true,
  // Req 6.2.1 - only the plugins this product's four capabilities (chat +
  // VLM, RAG embeddings, ASR, TTS) actually load. Keeping this list in sync
  // with config/models.config.ts's *_MODEL_TYPE constants is what makes
  // Task 4's tree-shaken build (bundleSdk()) actually lean instead of
  // silently pulling in the full addon set.
  plugins: [
    '@qvac/sdk/llamacpp-completion/plugin',
    '@qvac/sdk/llamacpp-embedding/plugin',
    '@qvac/sdk/whispercpp-transcription/plugin',
    '@qvac/sdk/tts-ggml/plugin',
  ],
};
