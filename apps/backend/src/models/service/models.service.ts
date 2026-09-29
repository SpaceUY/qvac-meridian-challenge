import { OperationCancelledError, toModelManagementError } from '../domain/errors.js';
import type { ModelProvisioningPort, ModelRuntimePort } from '../domain/ports.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadModelOptions,
  ModelDownloadProgress,
  ModelRequestStatus,
  ModelSource,
  RegistryModelSummary,
  RegistrySearchQuery
} from '../domain/types.js';
import { UNLOAD_ALL_LOG_PREFIX } from './models.service.const.js';

/**
 * Orchestrates local model management: discovery, download/setup -> load ->
 * inference -> unload -> close. Depends on `ModelProvisioningPort` (setup)
 * and `ModelRuntimePort` (discovery + lifecycle) rather than on `@qvac/sdk`
 * directly - two narrow interfaces instead of one, since provisioning isn't
 * a runtime concern - and is the single place that turns whatever either
 * one throws into a `ModelManagementError` tagged with the stage that
 * failed. Callers only ever need to handle that one error type.
 */
export class ModelManagementService {
  private readonly loaded = new Map<string, LoadedModel>();
  /** Outcome of every load/inference started via `loadModel()`/`infer()`, keyed by `requestId` - see `getRequestStatus()`. */
  private readonly requests = new Map<string, ModelRequestStatus>();

  constructor(
    private readonly provisioning: ModelProvisioningPort,
    private readonly runtime: ModelRuntimePort
  ) {}

  async searchRegistry(query: RegistrySearchQuery): Promise<RegistryModelSummary[]> {
    try {
      return await this.runtime.searchRegistry(query);
    } catch (err) {
      throw toModelManagementError('discovery', err);
    }
  }

  async listRegistry(): Promise<RegistryModelSummary[]> {
    try {
      return await this.runtime.listRegistry();
    } catch (err) {
      throw toModelManagementError('discovery', err);
    }
  }

  /** Setup/provisioning step: downloads weights to local disk without loading them into memory. */
  async provisionModel(source: ModelSource, onProgress?: (progress: ModelDownloadProgress) => void): Promise<void> {
    try {
      await this.provisioning.provision(source, onProgress);
    } catch (err) {
      throw toModelManagementError('download', err);
    }
  }

  /**
   * Not `async`: the returned promise is decorated with the `requestId`
   * `ModelRuntimePort.load()` exposes synchronously, so a caller can pass
   * it to `cancel()` while the load is still in flight - and, since the
   * HTTP layer responds as soon as `requestId` exists rather than waiting
   * for this promise to settle (see `models.router.ts`), `getRequestStatus()`
   * is how a caller later learns the outcome. An `async` method can't
   * expose `requestId` like this - it always wraps its return value in a
   * fresh `Promise`, stripping any extra property.
   *
   * A cancelled load never reaches the success branch below, so nothing is
   * added to `this.loaded` - the same `source` is safe to load again
   * afterward.
   */
  loadModel(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<LoadedModel> & { requestId: string } {
    const pending = this.runtime.load(source, options, onProgress);
    const requestId = pending.requestId;
    this.requests.set(requestId, { requestId, kind: 'load', state: 'pending' });

    const result = pending
      .then((loadedModel) => {
        this.loaded.set(loadedModel.modelId, loadedModel);
        this.requests.set(requestId, { requestId, kind: 'load', state: 'succeeded', modelId: loadedModel.modelId });
        return loadedModel;
      })
      .catch((err: unknown) => {
        this.requests.set(requestId, {
          requestId,
          kind: 'load',
          state: err instanceof OperationCancelledError ? 'cancelled' : 'failed'
        });
        throw toModelManagementError('load', err);
      });
    return Object.assign(result, { requestId });
  }

  /**
   * Same `requestId`-decorated-promise and `getRequestStatus()` convention
   * as `loadModel()`. A cancelled inference rejects this promise but never
   * touches `this.loaded`, so the model stays loaded and later `infer()`
   * calls for the same `modelId` are unaffected.
   */
  infer(modelId: string, prompt: string): Promise<InferenceResult> & { requestId: string } {
    this.assertLoaded(modelId);
    const pending = this.runtime.infer(modelId, prompt);
    const requestId = pending.requestId;
    this.requests.set(requestId, { requestId, kind: 'inference', state: 'pending', modelId });

    const result = pending
      .then((inferenceResult) => {
        this.requests.set(requestId, { requestId, kind: 'inference', state: 'succeeded', modelId, text: inferenceResult.text });
        return inferenceResult;
      })
      .catch((err: unknown) => {
        this.requests.set(requestId, {
          requestId,
          kind: 'inference',
          state: err instanceof OperationCancelledError ? 'cancelled' : 'failed',
          modelId
        });
        throw toModelManagementError('inference', err);
      });
    return Object.assign(result, { requestId });
  }

  /** Multi-turn chat completion with optional tool-calling, for chat-model consumers (e.g. `ChatQVAC`). */
  async chatComplete(modelId: string, request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    this.assertLoaded(modelId);
    try {
      return await this.runtime.chatComplete(modelId, request);
    } catch (err) {
      throw toModelManagementError('inference', err);
    }
  }

  async unloadModel(modelId: string): Promise<void> {
    this.assertLoaded(modelId);
    try {
      await this.runtime.unload(modelId);
      this.loaded.delete(modelId);
    } catch (err) {
      throw toModelManagementError('unload', err);
    }
  }

  /**
   * Best-effort unload of every currently loaded model, for a clean
   * shutdown sequence before `close()`. Never throws: each failure is
   * logged and the rest still run, since this is meant to run unattended
   * (e.g. from a SIGINT/SIGTERM handler) and one stuck model shouldn't
   * block the others from being released. Sequential, not concurrent: the
   * SDK's underlying connection is shared across all models, and unloading
   * two models at once races each other's internal connection teardown
   * (observed as one unload aborting with "SDK is shutting down").
   */
  async unloadAll(): Promise<void> {
    const modelIds = [...this.loaded.keys()];
    for (const modelId of modelIds) {
      await this.unloadModel(modelId).catch((err: unknown) => {
        console.error(`${UNLOAD_ALL_LOG_PREFIX} failed to unload "${modelId}"`, err);
      });
    }
  }

  /** Closes the underlying runtime connection. Safe to call even if nothing was ever loaded. */
  async close(): Promise<void> {
    try {
      await this.runtime.close();
    } catch (err) {
      throw toModelManagementError('close', err);
    }
  }

  /**
   * Cancels an in-flight load or inference by the `requestId` exposed on
   * the promise `loadModel()`/`infer()` return. Safe to call with a
   * `requestId` that's unknown, already settled, or already cancelled -
   * the runtime resolves rather than throwing for all of those, so there's
   * no local bookkeeping to keep in sync here.
   */
  async cancel(requestId: string): Promise<void> {
    try {
      await this.runtime.cancel(requestId);
    } catch (err) {
      throw toModelManagementError('cancel', err);
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
      throw toModelManagementError('not-found', new Error(`Model "${modelId}" is not currently loaded`));
    }
  }
}
