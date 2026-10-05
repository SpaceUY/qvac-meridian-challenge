import type { LoadModelOptions } from '../domain/types.js';

/** Builds the SDK's `modelConfig`: `ctx_size`/`tools` plus `engineConfig`, merged flat. Omits `ctx_size`/`tools` when unset - some engines (e.g. whisper) reject unrecognized keys even as `undefined`, since the SDK's RPC transport preserves `undefined`-valued keys instead of dropping them like `JSON.stringify` would. */
export function toSdkModelConfig(options?: LoadModelOptions): Record<string, unknown> | undefined {
  if (!options) return undefined;
  const config: Record<string, unknown> = {};
  if (options.ctxSize !== undefined) config.ctx_size = options.ctxSize;
  if (options.tools !== undefined) config.tools = options.tools;
  return { ...config, ...options.engineConfig };
}
