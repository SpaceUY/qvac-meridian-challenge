import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadedModelDelegationInfo,
  LoadModelOptions,
  ModelDownloadProgress,
  ModelSource,
  RegistryModelSummary,
  RegistrySearchQuery
} from './types.js';

/**
 * The setup concern: getting weights onto local disk. Separate from
 * `ModelRuntimePort` because provisioning is not a runtime operation - it
 * has no loaded model, no inference, nothing to unload. A single adapter
 * (`QvacRuntimeAdapter`) implements both today, but nothing prevents
 * sourcing provisioning differently later (e.g. a pre-warm job that
 * downloads ahead of time) without touching runtime behavior.
 */
export interface ModelProvisioningPort {
  /** Downloads weights to local disk cache without loading them into memory (the setup/provisioning step). */
  provision(source: ModelSource, onProgress?: (progress: ModelDownloadProgress) => void): Promise<void>;
}

/**
 * The runtime concern: discovery plus the in-memory model lifecycle
 * (load -> inference -> unload -> close). `QvacRuntimeAdapter` is the only
 * implementation today; a different backend can be swapped in later by
 * implementing this interface, without touching `ModelManagementService`
 * or the HTTP layer.
 */
export interface ModelRuntimePort {
  searchRegistry(query: RegistrySearchQuery): Promise<RegistryModelSummary[]>;
  listRegistry(): Promise<RegistryModelSummary[]>;
  /**
   * The returned promise carries a `requestId`, available synchronously
   * before the load settles, so a caller can cancel it (`cancel()` below)
   * while it's still in flight - mirrors the QVAC SDK's own
   * `Promise<T> & { requestId: string }` convention for long-running calls.
   */
  load(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<LoadedModel> & { requestId: string };
  /** Same `requestId`-carrying convention as `load()`, for cancelling an in-flight inference. */
  infer(modelId: string, prompt: string): Promise<InferenceResult> & { requestId: string };
  /**
   * Multi-turn chat completion with optional tool-calling, for chat-model
   * consumers (e.g. `ChatQVAC`). Pass `onToken` to receive incremental
   * assistant-text segments as generation proceeds; omit it for a single
   * resolved result. Either way the returned promise resolves to the same
   * aggregated result, and carries `requestId` synchronously (same
   * cancellation convention as `load()`/`infer()`) so a caller can cancel
   * a long-running (especially streaming) generation while it's in flight.
   */
  chatComplete(
    modelId: string,
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void
  ): Promise<ChatCompletionResult> & { requestId: string };
  unload(modelId: string): Promise<void>;
  close(): Promise<void>;
  /**
   * Introspection on a loaded model - whether it's running locally or was
   * delegated to a remote provider. Optional: only the chat-completion
   * delegation path (`ChatQVAC`) needs it, so a `ModelRuntimePort` fake used
   * by an unrelated feature's tests doesn't have to implement it.
   */
  getLoadedModelInfo?(modelId: string): Promise<LoadedModelDelegationInfo>;
  /**
   * Cancels the in-flight load or inference identified by `requestId`
   * (as exposed by `load()`/`infer()`). Safe to call with a `requestId`
   * that is unknown, already settled, or already cancelled - it resolves
   * without throwing in all of those cases, same as the underlying SDK.
   */
  cancel(requestId: string): Promise<void>;
  /**
   * Deletes the KV cache stored under `kvCacheKey` (the `sessionId` passed
   * to `chatComplete()`), for every model. Safe for a key that doesn't
   * exist - it resolves without throwing, same as the underlying SDK.
   * Optional: only the chat-session path needs it, so a `ModelRuntimePort`
   * fake used by an unrelated feature's tests doesn't have to implement it.
   */
  deleteCache?(kvCacheKey: string): Promise<void>;
  /**
   * Round-trips a heartbeat to a delegated provider: resolves when it
   * answers, rejects when it is unreachable or `timeout` (ms) elapses.
   * Optional: only the provider health monitor needs it, so a
   * `ModelRuntimePort` fake used by an unrelated feature's tests doesn't
   * have to implement it.
   */
  heartbeat?(delegate: { providerPublicKey: string; timeout: number }): Promise<void>;
}
