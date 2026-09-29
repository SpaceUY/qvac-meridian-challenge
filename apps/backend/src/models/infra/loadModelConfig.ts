import type { LoadModelOptions } from '../domain/types.js';

/**
 * Builds the SDK's `modelConfig` object from `LoadModelOptions`: the two
 * named completion-engine fields (`ctx_size`/`tools`) plus any opaque
 * per-engine `engineConfig` (e.g. whisper's `language`/`detect_language`,
 * consumed by `speech/service/transcription.service.ts`), merged flat so
 * one options object can carry both without the SDK caring which engine
 * is loading. `ctx_size`/`tools` are only included when actually set -
 * some engines' modelConfig schemas (e.g. whisper's) reject unrecognized
 * keys even when their value is `undefined`, since the SDK's RPC transport
 * preserves `undefined`-valued keys instead of dropping them like
 * `JSON.stringify` would. Returns `undefined` when no options were passed,
 * matching `loadModel()`'s own optional `modelConfig` parameter.
 */
export function toSdkModelConfig(options?: LoadModelOptions): Record<string, unknown> | undefined {
  if (!options) return undefined;
  const config: Record<string, unknown> = {};
  if (options.ctxSize !== undefined) config.ctx_size = options.ctxSize;
  if (options.tools !== undefined) config.tools = options.tools;
  return { ...config, ...options.engineConfig };
}
