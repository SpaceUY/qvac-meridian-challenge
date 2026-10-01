import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  cancel,
  close,
  completion,
  CompletionFinal,
  downloadAsset,
  getLoadedModelInfo,
  InferenceCancelledError,
  loadModel,
  modelRegistryList,
  modelRegistrySearch,
  SDK_SERVER_ERROR_CODES,
  unloadModel,
} from "@qvac/sdk";
import {
  DelegatedProviderUnreachableError,
  OperationCancelledError,
} from "../domain/errors.js";
import type {
  ModelProvisioningPort,
  ModelRuntimePort,
} from "../domain/ports.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ChatMessage,
  InferenceResult,
  LoadedModel,
  LoadedModelDelegationInfo,
  LoadModelOptions,
  ModelDownloadProgress,
  ModelSource,
  RegistryModelSummary,
  RegistrySearchQuery,
  SupportedImageMimeType,
} from "../domain/types.js";
import { DEFAULT_MODEL_TYPE } from "../../config/models.config.js";
import { toSdkModelConfig } from "./loadModelConfig.js";

const EXTENSION_BY_MIME_TYPE: Record<SupportedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

interface SdkHistoryEntry {
  role: string;
  content: string;
  attachments?: { path: string }[];
}

/**
 * Writes each `ChatMessage.images` entry to a temp file - `completion()`'s
 * `attachments` only accepts a file path, never raw bytes
 * (`@qvac/sdk`'s own `dist/schemas/common.d.ts`). Returns the SDK-shaped
 * history (images replaced by `attachments`) plus every temp path written,
 * so the caller can delete them once inference settles. Synchronous
 * (`writeFileSync`) on purpose: `chatComplete()` below must stay
 * non-`async` to expose `requestId` synchronously (same constraint
 * `ModelManagementService.loadModel()`'s own doc comment explains) - an
 * `await` here would force the method to return a fresh `Promise` that
 * can't carry that extra property.
 */
function materializeAttachments(history: ChatMessage[]): {
  sdkHistory: SdkHistoryEntry[];
  tempFilePaths: string[];
} {
  const tempFilePaths: string[] = [];

  const sdkHistory = history.map((message): SdkHistoryEntry => {
    if (!message.images?.length) {
      return { role: message.role, content: message.content };
    }

    const attachments = message.images.map((image) => {
      const tempPath = path.join(
        os.tmpdir(),
        `qvac-vlm-${randomUUID()}.${EXTENSION_BY_MIME_TYPE[image.mimeType]}`,
      );
      fs.writeFileSync(tempPath, image.data);
      tempFilePaths.push(tempPath);
      return { path: tempPath };
    });

    return { role: message.role, content: message.content, attachments };
  });

  return { sdkHistory, tempFilePaths };
}

/** Best-effort: a leftover temp file in `os.tmpdir()` is not worth failing or logging an in-flight chat request over. */
function cleanupTempFiles(tempFilePaths: string[]): void {
  for (const tempPath of tempFilePaths) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // best effort, see doc comment above
    }
  }
}

/**
 * The only file in this feature that imports `@qvac/sdk`. Translates
 * between the domain types in `../domain` and the SDK's own request/response
 * shapes, so the rest of the feature (service, HTTP layer, demo script)
 * never has to know the SDK exists. Implements both `ModelProvisioningPort`
 * (setup) and `ModelRuntimePort` (discovery + lifecycle) - one adapter, two
 * narrow contracts, so a consumer that only needs one doesn't depend on
 * the other.
 */
export class QvacRuntimeAdapter
  implements ModelProvisioningPort, ModelRuntimePort
{
  async searchRegistry(
    query: RegistrySearchQuery,
  ): Promise<RegistryModelSummary[]> {
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
  async provision(
    source: ModelSource,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<void> {
    await downloadAsset({
      assetSrc: toModelSrc(source),
      onProgress: toSdkProgressCallback(onProgress),
    });
  }

  /**
   * `requestId` is available synchronously on `loadModel()`'s returned
   * promise (`Promise<string> & { requestId: string }`, per the SDK's own
   * type) - grabbed before the `await`/`.then()` so it's usable to cancel
   * this exact load while it's still in flight.
   */
  load(
    source: ModelSource,
    options?: LoadModelOptions,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<LoadedModel> & { requestId: string } {
    const call = loadModel({
      modelSrc: toModelSrc(source),
      modelType: source.modelType ?? DEFAULT_MODEL_TYPE,
      modelConfig: toSdkModelConfig(options),
      delegate: options?.delegate,
      onProgress: toSdkProgressCallback(onProgress),
    });
    const requestId = call.requestId;
    const result = call
      .then((modelId) => ({ modelId, source, loadedAt: new Date() }))
      .catch((err: unknown) => {
        throw toDomainError(requestId, err);
      });
    return Object.assign(result, { requestId });
  }

  /** Same synchronous-`requestId` convention as `load()`, off `completion()`'s own `CompletionRun.requestId`. */
  infer(
    modelId: string,
    prompt: string,
  ): Promise<InferenceResult> & { requestId: string } {
    const run = completion({
      modelId,
      history: [{ role: "user", content: prompt }],
      stream: false,
      kvCache: true,
    });
    const requestId = run.requestId;
    const result = run.final
      .then((final) => ({ text: final.contentText }))
      .catch((err: unknown) => {
        throw toDomainError(requestId, err);
      });
    return Object.assign(result, { requestId });
  }

  /**
   * `onToken`'s presence selects streaming: it drives `completion()`'s own
   * `stream` flag, and the returned promise carries `requestId`
   * synchronously - same convention as `load()`/`infer()` - so a caller can
   * cancel a long-running (especially streaming) generation in flight.
   *
   * `request.sessionId`, when present, is passed straight through as
   * `kvCache`'s string form - `completion()`'s own `kvCache` accepts
   * `boolean | string`, where a string is a caller-supplied cache key for
   * manual per-session management (vs. `true`'s auto-generated key hashed
   * from conversation history). Falls back to `true` when absent, e.g. for
   * a caller that never threads a session id through (`infer()`, or the
   * voice-completions path). `request.kvCacheEnabled === false` overrides
   * both and disables the KV cache outright, regardless of `sessionId`.
   */
  chatComplete(
    modelId: string,
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    const { sdkHistory, tempFilePaths } = materializeAttachments(
      request.history,
    );

    const run = completion({
      modelId,
      history: sdkHistory,
      tools: request.tools,
      captureThinking: true,
      stream: Boolean(onToken),
      kvCache: request.kvCacheEnabled === false ? false : request.sessionId ?? true,
      generationParams:
        request.temperature !== undefined || request.seed !== undefined
          ? { temp: request.temperature, seed: request.seed }
          : undefined,
    });
    const requestId = run.requestId;

    if (onToken) {
      void (async () => {
        try {
          for await (const event of run.events) {
            if (event.type === "contentDelta") onToken(event.text);
          }
        } catch {
          // Surfaced via `run.final` -> `result` below; avoids reporting
          // the same failure twice (and an unhandled-rejection here).
        }
      })();
    }

    const result = run.final
      .then((final: CompletionFinal) => ({
        text: final.contentText,
        toolCalls: final.toolCalls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })),
        thinkingText: final.thinkingText,
        stats: final.stats,
      }))
      .catch((err: unknown) => {
        throw toDomainError(requestId, err);
      })
      .finally(() => cleanupTempFiles(tempFilePaths));

    return Object.assign(result, { requestId });
  }

  async unload(modelId: string): Promise<void> {
    await unloadModel({ modelId, clearStorage: false });
  }

  async close(): Promise<void> {
    await close();
  }

  /**
   * Cancels by `requestId` (the primary path since SDK 0.11.0) - works for
   * both an in-flight `load()` and an in-flight `infer()`, since both are
   * registered against the same request registry server-side. Confirmed
   * against the real SDK (see `qvac-local-lifecycle-lab`) that this
   * resolves rather than rejecting for an unknown, already-settled, or
   * already-cancelled `requestId`, so no pre-check is needed here.
   */
  async cancel(requestId: string): Promise<void> {
    await cancel({ requestId });
  }

  /**
   * The SDK's `getLoadedModelInfo()` returns a discriminated union keyed on
   * `isDelegated` (`providerInfo.providerPublicKey` only present when
   * `true`) - narrowed here to the two fields this feature's domain
   * actually needs, so a caller never has to know about `handlers`/
   * `modelType`/etc., which only matter for the local-model preflight use
   * case this feature doesn't use.
   */
  async getLoadedModelInfo(
    modelId: string,
  ): Promise<LoadedModelDelegationInfo> {
    const info = await getLoadedModelInfo({ modelId });
    return {
      isDelegated: info.isDelegated,
      providerPublicKey: info.isDelegated
        ? info.providerInfo.providerPublicKey
        : undefined,
    };
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
    expectedSizeBytes: entry.expectedSize,
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
 * catalog (`dist/server/rpc/handlers/load-model/resolve.js`). For `rawSrc`
 * sources the string is already in whatever form the SDK's own catalog
 * exports it in (e.g. a VLM projection model's `.src`), so it's passed
 * through unwrapped, same as `url`. Shared by `load()` and `provision()` so
 * the scheme is defined in exactly one place.
 */
/**
 * Translates the SDK's cancellation errors into the domain-level
 * `OperationCancelledError`; passes any other error through unchanged.
 * Two different shapes cross this boundary for the same event:
 *  - `InferenceCancelledError`, constructed client-side from the
 *    completion stream's own aggregated state (chat/infer) - a real
 *    instance of the class re-exported from `@qvac/sdk`.
 *  - A cancelled `loadModel()` call, which never round-trips as an
 *    `InferenceCancelledError` instance (that class has no typed
 *    RPC reconstructor registered - see `@qvac/sdk`'s own
 *    `rpc-error.ts`) but carries the same `INFERENCE_CANCELLED` code.
 */
function toDomainError(requestId: string, err: unknown): unknown {
  const isCancelled =
    err instanceof InferenceCancelledError ||
    (err instanceof Error &&
      "code" in err &&
      err.code === SDK_SERVER_ERROR_CODES.INFERENCE_CANCELLED);
  if (isCancelled) return new OperationCancelledError(requestId);
  if (isProviderUnreachableError(err))
    return new DelegatedProviderUnreachableError(err);
  return err;
}

/**
 * A delegated model's completion fails with the SDK's generic
 * `COMPLETION_FAILED` code both for this (the provider is unreachable)
 * and for a genuine completion failure (bad input, a model crash, etc.) -
 * `CompletionFailedError` itself isn't part of `@qvac/sdk`'s public API to
 * `instanceof`-check against, so this narrows on the exact message
 * `handleCompletionStreamDelegated` (`dist/server/rpc/handlers/completion-
 * stream-delegated.js`) sets for a connection failure specifically, the
 * same way the cancellation check above narrows on a code rather than a
 * class. `ChatQVAC.getDelegationInfo()`/`recoverFromDelegationFailure()`
 * rely on this to tell "reload and retry locally" apart from "surface a
 * genuine completion error".
 */
function isProviderUnreachableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    err.code === SDK_SERVER_ERROR_CODES.COMPLETION_FAILED &&
    /communicating with provider/i.test(err.message)
  );
}

function toModelSrc(source: ModelSource): string {
  if (source.kind === "url") return source.url;
  if (source.kind === "rawSrc") return source.src;
  return `registry://${source.registrySource}/${source.registryPath}`;
}

interface SdkDownloadProgress {
  percentage: number;
  downloaded: number;
  total: number;
}

/** Shared by `load()` and `provision()` so the progress-field mapping lives in one place. */
function toSdkProgressCallback(
  onProgress?: (progress: ModelDownloadProgress) => void,
): ((progress: SdkDownloadProgress) => void) | undefined {
  if (!onProgress) return undefined;
  return (p) =>
    onProgress({
      percentage: p.percentage,
      downloadedBytes: p.downloaded,
      totalBytes: p.total,
    });
}
