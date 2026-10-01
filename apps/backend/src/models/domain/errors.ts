/**
 * Which phase of local model management a failure happened in. `not-found`
 * is a precondition failure (the requested model isn't currently loaded),
 * distinct from `inference`/`unload` actually failing on a loaded model -
 * the HTTP layer maps it to 404 instead of the other stages' 502.
 */
export type ModelManagementStage =
  | 'discovery'
  | 'download'
  | 'load'
  | 'inference'
  | 'unload'
  | 'close'
  | 'cancel'
  | 'introspect'
  | 'cache'
  | 'heartbeat'
  | 'not-found';

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

/**
 * Thrown by a `ModelRuntimePort` implementation when a load or inference
 * settles because `cancel(requestId)` was called, as opposed to genuinely
 * failing. Domain-level (not `@qvac/sdk`'s `InferenceCancelledError`) so
 * `ModelManagementService` can tell "cancelled" apart from "failed" - see
 * `getRequestStatus()` - without importing the SDK.
 */
export class OperationCancelledError extends Error {
  readonly requestId: string;

  constructor(requestId: string) {
    super(`Operation "${requestId}" was cancelled`);
    this.name = 'OperationCancelledError';
    this.requestId = requestId;
  }
}

/** True if `err` is a `ModelManagementError` caused by `cancel()`, as opposed to a genuine failure. */
export function isCancellationError(err: unknown): boolean {
  return err instanceof ModelManagementError && err.cause instanceof OperationCancelledError;
}

/**
 * Thrown by a `ModelRuntimePort` implementation when a chat completion
 * fails specifically because a *delegated* model's remote provider could
 * not be reached (the provider process is down/unreachable), as opposed
 * to a genuine completion failure (bad input, a model crash, etc.) on an
 * otherwise-healthy connection. Distinct from `OperationCancelledError`
 * for the same reason: `@qvac/sdk`'s `fallbackToLocal` only ever applies
 * at `loadModel()` time - once a model is loaded and registered as
 * delegated, a later completion against a now-dead provider just fails,
 * with no SDK-level recovery. `QvacChatSession` uses this to tell "the provider
 * died mid-session, reload (which will itself fall back to local) and
 * retry once" apart from any other inference failure, which it should
 * not blindly retry.
 */
export class DelegatedProviderUnreachableError extends Error {
  constructor(cause?: unknown) {
    super('The delegated model\'s provider could not be reached');
    this.name = 'DelegatedProviderUnreachableError';
    this.cause = cause;
  }
}

/** True if `err` is a `ModelManagementError` caused by the delegated provider being unreachable (see `DelegatedProviderUnreachableError`). */
export function isDelegatedProviderUnreachableError(err: unknown): boolean {
  return err instanceof ModelManagementError && err.cause instanceof DelegatedProviderUnreachableError;
}
