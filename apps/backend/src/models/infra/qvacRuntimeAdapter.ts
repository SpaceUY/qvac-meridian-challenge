import { close, completion, downloadAsset, loadModel, modelRegistryList, modelRegistrySearch, unloadModel } from '@qvac/sdk';
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
import { DEFAULT_MODEL_TYPE } from './qvacRuntimeAdapter.const.js';

/**
 * The only file in this feature that imports `@qvac/sdk`. Translates
 * between the domain types in `../domain` and the SDK's own request/response
 * shapes, so the rest of the feature (service, HTTP layer, demo script)
 * never has to know the SDK exists. Implements both `ModelProvisioningPort`
 * (setup) and `ModelRuntimePort` (discovery + lifecycle) - one adapter, two
 * narrow contracts, so a consumer that only needs one doesn't depend on
 * the other.
 */
export class QvacRuntimeAdapter implements ModelProvisioningPort, ModelRuntimePort {
  async searchRegistry(query: RegistrySearchQuery): Promise<RegistryModelSummary[]> {
    const entries = await modelRegistrySearch(query);
    return entries.map(toRegistryModelSummary);
  }

  async listRegistry(): Promise<RegistryModelSummary[]> {
    const entries = await modelRegistryList();
    return entries.map(toRegistryModelSummary);
  }

  /**
   * Setup/provisioning step: downloads weights to the local disk cache
   * without loading them into memory, via the SDK's `downloadAsset()` -
   * documented as the dedicated download-only alternative to `loadModel()`
   * (`@qvac/sdk/dist/client/api/download-asset.d.ts`). A subsequent `load()`
   * for the same source reuses the cached file instead of re-downloading:
   * both the HTTP and registry download paths validate the cache first
   * (`validateCachedFile` in `dist/server/rpc/handlers/load-model/http.js`
   * and `registry.js`).
   */
  async provision(source: ModelSource, onProgress?: (progress: ModelDownloadProgress) => void): Promise<void> {
    await downloadAsset({
      assetSrc: toModelSrc(source),
      onProgress: toSdkProgressCallback(onProgress)
    });
  }

  async load(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<LoadedModel> {
    const modelId = await loadModel({
      modelSrc: toModelSrc(source),
      modelType: source.modelType ?? DEFAULT_MODEL_TYPE,
      modelConfig: options && { ctx_size: options.ctxSize, tools: options.tools },
      onProgress: toSdkProgressCallback(onProgress)
    });
    return { modelId, source, loadedAt: new Date() };
  }

  async infer(modelId: string, prompt: string): Promise<InferenceResult> {
    const run = completion({ modelId, history: [{ role: 'user', content: prompt }], stream: false });
    const final = await run.final;
    return { text: final.contentText };
  }

  async chatComplete(modelId: string, request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    const run = completion({
      modelId,
      history: request.history,
      tools: request.tools,
      stream: false,
      generationParams: request.temperature !== undefined ? { temp: request.temperature } : undefined
    });
    const final = await run.final;
    return {
      text: final.contentText,
      toolCalls: final.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
      stats: final.stats
    };
  }

  async unload(modelId: string): Promise<void> {
    await unloadModel({ modelId, clearStorage: false });
  }

  async close(): Promise<void> {
    await close();
  }
}

function toRegistryModelSummary(entry: {
  name: string;
  registryPath: string;
  registrySource: string;
  engine: string;
  addon: string;
  quantization: string;
  params: string;
  expectedSize: number;
}): RegistryModelSummary {
  return {
    name: entry.name,
    registryPath: entry.registryPath,
    registrySource: entry.registrySource,
    engine: entry.engine,
    addon: entry.addon,
    quantization: entry.quantization,
    params: entry.params,
    expectedSizeBytes: entry.expectedSize
  };
}

/**
 * Builds the `modelSrc`/`assetSrc` string both `loadModel()` and
 * `downloadAsset()` accept. For `url` sources this is just the
 * HTTPS/HuggingFace URL, passed straight through (verified against the
 * SDK's own `examples/llamacpp-http.js`). For `registry` sources it
 * reconstructs the `registry://<registrySource>/<registryPath>` form -
 * confirmed against the SDK's server-side resolver, which parses exactly
 * this scheme via `registryUrlSchema` (regex `^registry:\/\/([^/]+)\/(.+)$`
 * in `dist/schemas/load-model.js`) and looks up the path in its own
 * catalog (`dist/server/rpc/handlers/load-model/resolve.js`). Shared by
 * `load()` and `provision()` so the scheme is defined in exactly one place.
 */
function toModelSrc(source: ModelSource): string {
  if (source.kind === 'url') return source.url;
  return `registry://${source.registrySource}/${source.registryPath}`;
}

interface SdkDownloadProgress {
  percentage: number;
  downloaded: number;
  total: number;
}

/** Shared by `load()` and `provision()` so the progress-field mapping lives in one place. */
function toSdkProgressCallback(
  onProgress?: (progress: ModelDownloadProgress) => void
): ((progress: SdkDownloadProgress) => void) | undefined {
  if (!onProgress) return undefined;
  return (p) => onProgress({ percentage: p.percentage, downloadedBytes: p.downloaded, totalBytes: p.total });
}
