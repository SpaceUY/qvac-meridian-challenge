import {
  OperationCancelledError,
  toModelManagementError,
} from "../domain/errors.js";
import type {
  ModelProvisioningPort,
  ModelRuntimePort,
} from "../domain/ports.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadedModelDelegationInfo,
  LoadModelOptions,
  ModelDownloadProgress,
  ModelRequestStatus,
  ModelSource,
  RegistryModelSummary,
  RegistrySearchQuery,
} from "../domain/types.js";
import { UNLOAD_ALL_LOG_PREFIX } from "./models.service.const.js";

/** Orchestrates local model management: discovery, download/setup -> load -> inference -> unload -> close. Depends on `ModelProvisioningPort`/`ModelRuntimePort` (not `@qvac/sdk` directly) and turns whatever either throws into one `ModelManagementError` tagged by stage. */
export class ModelManagementService {
  private readonly loaded = new Map<string, LoadedModel>();
  /** Outcome of every load/inference started via `loadModel()`/`infer()`, keyed by `requestId` - see `getRequestStatus()`. */
  private readonly requests = new Map<string, ModelRequestStatus>();

  constructor(
    private readonly provisioning: ModelProvisioningPort,
    private readonly runtime: ModelRuntimePort,
  ) {}

  async searchRegistry(
    query: RegistrySearchQuery,
  ): Promise<RegistryModelSummary[]> {
    try {
      return await this.runtime.searchRegistry(query);
    } catch (err) {
      throw toModelManagementError("discovery", err);
    }
  }

  async listRegistry(): Promise<RegistryModelSummary[]> {
    try {
      return await this.runtime.listRegistry();
    } catch (err) {
      throw toModelManagementError("discovery", err);
    }
  }

  /** Setup/provisioning step: downloads weights to local disk without loading them into memory. */
  async provisionModel(
    source: ModelSource,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<void> {
    try {
      await this.provisioning.provision(source, onProgress);
    } catch (err) {
      throw toModelManagementError("download", err);
    }
  }

  /** Not `async`: the promise is decorated with `requestId` so a caller can `cancel()` before it settles; `getRequestStatus()` reports the outcome later. A cancelled load never reaches `this.loaded`, so the same `source` is safe to retry. */
  loadModel(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<LoadedModel> & { requestId: string } {
    const pending = this.runtime.load(source, options, onProgress);
    const requestId = pending.requestId;
    this.requests.set(requestId, { requestId, kind: "load", state: "pending" });

    const result = pending
      .then((loadedModel) => {
        this.loaded.set(loadedModel.modelId, loadedModel);
        this.requests.set(requestId, {
          requestId,
          kind: "load",
          state: "succeeded",
          modelId: loadedModel.modelId,
        });
        return loadedModel;
      })
      .catch((err: unknown) => {
        this.requests.set(requestId, {
          requestId,
          kind: "load",
          state:
            err instanceof OperationCancelledError ? "cancelled" : "failed",
        });
        throw toModelManagementError("load", err);
      });
    return Object.assign(result, { requestId });
  }

  /** Same requestId convention as `loadModel()`; a cancelled inference leaves the model loaded for later `infer()` calls. */
  infer(
    modelId: string,
    prompt: string,
  ): Promise<InferenceResult> & { requestId: string } {
    this.assertLoaded(modelId);
    const pending = this.runtime.infer(modelId, prompt);
    const requestId = pending.requestId;
    this.requests.set(requestId, {
      requestId,
      kind: "inference",
      state: "pending",
      modelId,
    });

    const result = pending
      .then((inferenceResult) => {
        this.requests.set(requestId, {
          requestId,
          kind: "inference",
          state: "succeeded",
          modelId,
          text: inferenceResult.text,
        });
        return inferenceResult;
      })
      .catch((err: unknown) => {
        this.requests.set(requestId, {
          requestId,
          kind: "inference",
          state:
            err instanceof OperationCancelledError ? "cancelled" : "failed",
          modelId,
        });
        throw toModelManagementError("inference", err);
      });
    return Object.assign(result, { requestId });
  }

  /**
   * Multi-turn chat completion with optional tool-calling; `onToken` receives incremental assistant-text segments.
   * Same requestId convention as `infer()` - a cancelled completion leaves the model loaded.
   */
  chatComplete(
    modelId: string,
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    this.assertLoaded(modelId);
    const pending = this.runtime.chatComplete(modelId, request, onToken);
    const requestId = pending.requestId;
    this.requests.set(requestId, {
      requestId,
      kind: "chat",
      state: "pending",
      modelId,
    });

    const result = pending
      .then((chatCompletionResult) => {
        this.requests.set(requestId, {
          requestId,
          kind: "chat",
          state: "succeeded",
          modelId,
          text: chatCompletionResult.text,
        });
        return chatCompletionResult;
      })
      .catch((err: unknown) => {
        this.requests.set(requestId, {
          requestId,
          kind: "chat",
          state:
            err instanceof OperationCancelledError ? "cancelled" : "failed",
          modelId,
        });
        throw toModelManagementError("inference", err);
      });
    return Object.assign(result, { requestId });
  }

  async unloadModel(modelId: string): Promise<void> {
    this.assertLoaded(modelId);
    try {
      await this.runtime.unload(modelId);
      this.loaded.delete(modelId);
    } catch (err) {
      throw toModelManagementError("unload", err);
    }
  }

  /**
   * Best-effort unload of every loaded model for a clean shutdown; never throws (each failure is logged, the rest still run).
   * Sequential, not concurrent: the SDK's shared connection races unload teardown if two run at once (observed as "SDK is shutting down").
   */
  async unloadAll(): Promise<void> {
    const modelIds = [...this.loaded.keys()];
    for (const modelId of modelIds) {
      await this.unloadModel(modelId).catch((err: unknown) => {
        console.error(
          `${UNLOAD_ALL_LOG_PREFIX} failed to unload "${modelId}"`,
          err,
        );
      });
    }
  }

  /** Closes the underlying runtime connection. Safe to call even if nothing was ever loaded. */
  async close(): Promise<void> {
    try {
      await this.runtime.close();
    } catch (err) {
      throw toModelManagementError("close", err);
    }
  }

  /** Cancels an in-flight load/inference by `requestId`; safe for an unknown, settled, or already-cancelled id (the runtime resolves rather than throws for all of those). */
  async cancel(requestId: string): Promise<void> {
    try {
      await this.runtime.cancel(requestId);
    } catch (err) {
      throw toModelManagementError("cancel", err);
    }
  }

  /** Cancels every chat completion on `modelId`; fails with `"cancel"` if the runtime doesn't implement it (only the delegated chat path needs it), rather than silently leaving it running. */
  async cancelCompletions(modelId: string): Promise<void> {
    if (!this.runtime.cancelCompletions) {
      throw toModelManagementError("cancel", new Error("This runtime does not support cancelCompletions()"));
    }
    try {
      await this.runtime.cancelCompletions(modelId);
    } catch (err) {
      throw toModelManagementError("cancel", err);
    }
  }

  /** Deletes the KV cache under `kvCacheKey` (a chat session's id); fails with `"cache"` if the runtime doesn't implement it, rather than silently leaving it behind. */
  async deleteCache(kvCacheKey: string): Promise<void> {
    if (!this.runtime.deleteCache) {
      throw toModelManagementError("cache", new Error("This runtime does not support deleteCache()"));
    }
    try {
      await this.runtime.deleteCache(kvCacheKey);
    } catch (err) {
      throw toModelManagementError("cache", err);
    }
  }

  /** Whether a loaded model is running locally or delegated; fails with `"introspect"` if the runtime doesn't implement it, rather than silently reporting "not delegated". */
  async getLoadedModelInfo(modelId: string): Promise<LoadedModelDelegationInfo> {
    this.assertLoaded(modelId);
    if (!this.runtime.getLoadedModelInfo) {
      throw toModelManagementError(
        "introspect",
        new Error("This runtime does not support getLoadedModelInfo()"),
      );
    }
    try {
      return await this.runtime.getLoadedModelInfo(modelId);
    } catch (err) {
      throw toModelManagementError("introspect", err);
    }
  }

  /** Checks a delegated provider is reachable; fails with `"heartbeat"` if the runtime doesn't implement it - counted as a failed check by the health monitor. */
  async heartbeat(delegate: { providerPublicKey: string; timeout: number }): Promise<void> {
    if (!this.runtime.heartbeat) {
      throw toModelManagementError("heartbeat", new Error("This runtime does not support heartbeat()"));
    }
    try {
      await this.runtime.heartbeat(delegate);
    } catch (err) {
      throw toModelManagementError("heartbeat", err);
    }
  }

  isLoaded(modelId: string): boolean {
    return this.loaded.has(modelId);
  }

  /** Outcome of a `loadModel()`/`infer()` call by its `requestId`, or `undefined` if that `requestId` was never issued. */
  getRequestStatus(requestId: string): ModelRequestStatus | undefined {
    return this.requests.get(requestId);
  }

  private assertLoaded(modelId: string): void {
    if (!this.loaded.has(modelId)) {
      throw toModelManagementError(
        "not-found",
        new Error(`Model "${modelId}" is not currently loaded`),
      );
    }
  }
}
