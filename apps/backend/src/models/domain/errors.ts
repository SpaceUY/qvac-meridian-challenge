/**
 * Which phase of local model management a failure happened in. `not-found`
 * is a precondition failure (the requested model isn't currently loaded),
 * distinct from `inference`/`unload` actually failing on a loaded model -
 * the HTTP layer maps it to 404 instead of the other stages' 502.
 */
export type ModelManagementStage = 'discovery' | 'download' | 'load' | 'inference' | 'unload' | 'close' | 'not-found';

/**
 * Single error type for the whole feature so callers (the HTTP layer, the
 * demo script) have one thing to catch instead of reaching into
 * `@qvac/sdk`'s error hierarchy. `cause` keeps the original error for
 * server-side logging; it is intentionally never serialized back to a
 * client (see `models.router.ts`).
 */
export class ModelManagementError extends Error {
  readonly stage: ModelManagementStage;
  override readonly cause?: unknown;

  constructor(stage: ModelManagementStage, message: string, cause?: unknown) {
    super(message);
    this.name = 'ModelManagementError';
    this.stage = stage;
    this.cause = cause;
  }
}

/** Wraps an unknown thrown value into a `ModelManagementError`, tagging it with the stage that produced it. */
export function toModelManagementError(stage: ModelManagementStage, err: unknown): ModelManagementError {
  if (err instanceof ModelManagementError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ModelManagementError(stage, message, err);
}
