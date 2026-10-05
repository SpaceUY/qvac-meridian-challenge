/** Which phase failed; `not-found` is a precondition miss, distinct from a genuine inference/unload failure. */
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

/** Single error type for the whole feature; `cause` is logged server-side but never serialized back to a client. */
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

/** Domain-level (not the SDK's own) so `ModelManagementService` can tell "cancelled" from "failed" without importing `@qvac/sdk`. */
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

/** Signals a delegated provider went unreachable mid-session (`@qvac/sdk`'s `fallbackToLocal` only applies at `loadModel()` time) - lets `QvacChatSession` reload+retry once instead of treating it like any other completion failure. */
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
