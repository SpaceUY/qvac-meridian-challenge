import { toModelManagementError } from '../domain/errors.js';
import type { ModelProvisioningPort, ModelRuntimePort } from '../domain/ports.js';
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

  async loadModel(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<LoadedModel> {
    try {
      const loadedModel = await this.runtime.load(source, options, onProgress);
      this.loaded.set(loadedModel.modelId, loadedModel);
      return loadedModel;
    } catch (err) {
      throw toModelManagementError('load', err);
    }
  }

  async infer(modelId: string, prompt: string): Promise<InferenceResult> {
    this.assertLoaded(modelId);
    try {
      return await this.runtime.infer(modelId, prompt);
    } catch (err) {
      throw toModelManagementError('inference', err);
    }
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
   * block the others from being released.
   */
  async unloadAll(): Promise<void> {
    const modelIds = [...this.loaded.keys()];
    await Promise.all(
      modelIds.map((modelId) =>
        this.unloadModel(modelId).catch((err: unknown) => {
          console.error(`${UNLOAD_ALL_LOG_PREFIX} failed to unload "${modelId}"`, err);
        })
      )
    );
  }

  /** Closes the underlying runtime connection. Safe to call even if nothing was ever loaded. */
  async close(): Promise<void> {
    try {
      await this.runtime.close();
    } catch (err) {
      throw toModelManagementError('close', err);
    }
  }

  isLoaded(modelId: string): boolean {
    return this.loaded.has(modelId);
  }

  private assertLoaded(modelId: string): void {
    if (!this.loaded.has(modelId)) {
      throw toModelManagementError('not-found', new Error(`Model "${modelId}" is not currently loaded`));
    }
  }
}
