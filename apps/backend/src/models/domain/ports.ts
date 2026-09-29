import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
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
  load(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<LoadedModel>;
  infer(modelId: string, prompt: string): Promise<InferenceResult>;
  /** Multi-turn chat completion with optional tool-calling, for chat-model consumers (e.g. `ChatQVAC`). */
  chatComplete(modelId: string, request: ChatCompletionRequest): Promise<ChatCompletionResult>;
  unload(modelId: string): Promise<void>;
  close(): Promise<void>;
}
