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

/** Setup-only: getting weights onto disk, no runtime concerns. Separate from `ModelRuntimePort` so provisioning can be sourced differently later without touching runtime behavior. */
export interface ModelProvisioningPort {
  /** Downloads weights to local disk cache without loading them into memory (the setup/provisioning step). */
  provision(source: ModelSource, onProgress?: (progress: ModelDownloadProgress) => void): Promise<void>;
}

/** Runtime concern: discovery + in-memory lifecycle (load -> inference -> unload -> close). Swappable later by implementing this interface. */
export interface ModelRuntimePort {
  searchRegistry(query: RegistrySearchQuery): Promise<RegistryModelSummary[]>;
  listRegistry(): Promise<RegistryModelSummary[]>;
  /** `requestId` is available synchronously before the load settles, so a caller can `cancel()` it while in flight. */
  load(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<LoadedModel> & { requestId: string };
  /** Same `requestId`-carrying convention as `load()`, for cancelling an in-flight inference. */
  infer(modelId: string, prompt: string): Promise<InferenceResult> & { requestId: string };
  /** Multi-turn completion with optional tool-calling and streaming (`onToken`); always carries `requestId` for cancellation. */
  chatComplete(
    modelId: string,
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void
  ): Promise<ChatCompletionResult> & { requestId: string };
  unload(modelId: string): Promise<void>;
  close(): Promise<void>;
  /** Optional: only the chat-completion delegation path needs it, so unrelated `ModelRuntimePort` fakes don't have to implement it. */
  getLoadedModelInfo?(modelId: string): Promise<LoadedModelDelegationInfo>;
  /** Safe to call with an unknown/already-settled/already-cancelled `requestId` - resolves without throwing, same as the SDK. */
  cancel(requestId: string): Promise<void>;
  /** Optional; needed because `cancel(requestId)` can't stop a completion on a *delegated* model - the SDK never forwards it to the provider. */
  cancelCompletions?(modelId: string): Promise<void>;
  /** Deletes a KV cache entry by `sessionId`, safe for an unknown key. Optional - only the chat-session path needs it. */
  deleteCache?(kvCacheKey: string): Promise<void>;
  /** Round-trips a heartbeat to a delegated provider. Optional - only the provider health monitor needs it. */
  heartbeat?(delegate: { providerPublicKey: string; timeout: number }): Promise<void>;
}
