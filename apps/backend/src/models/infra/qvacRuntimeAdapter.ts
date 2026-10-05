import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import {
  cancel,
  close,
  completion,
  CompletionFinal,
  deleteCache,
  downloadAsset,
  getLoadedModelInfo,
  heartbeat,
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
import { MAX_REPLY_TOKENS, REPEAT_PENALTY } from "./qvacRuntimeAdapter.const.js";

const EXTENSION_BY_MIME_TYPE: Record<SupportedImageMimeType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
};

interface SdkHistoryEntry {
  role: string;
  content: string;
  attachments?: { path: string }[];
}

/** `completion()`'s `attachments` only accept a file path, never raw bytes, so each image is written to a temp file. Synchronous (`writeFileSync`) - `chatComplete()` below must stay non-async to expose `requestId` synchronously. */
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
      // best effort
    }
  }
}

/** The only file here that imports `@qvac/sdk`. Implements both `ModelProvisioningPort` and `ModelRuntimePort` so a consumer needing only one doesn't depend on the other. */
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

  /** Downloads weights via the SDK's `downloadAsset()` without loading into memory; a later `load()` for the same source reuses the cached file. */
  async provision(
    source: ModelSource,
    onProgress?: (progress: ModelDownloadProgress) => void,
  ): Promise<void> {
    await downloadAsset({
      assetSrc: toModelSrc(source),
      onProgress: toSdkProgressCallback(onProgress),
    });
  }

  /** `requestId` is grabbed from the SDK's returned promise before `.then()`, so it's usable to cancel this load while in flight. */
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
   * `onToken`'s presence selects streaming (same `requestId` convention as `load()`/`infer()`).
   * `sessionId`, when present, becomes `kvCache`'s string form (a manual per-session cache key)
   * instead of `true`'s auto-generated one; `kvCacheEnabled === false` overrides both.
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
      generationParams: {
        ...(request.temperature !== undefined ? { temp: request.temperature } : {}),
        ...(request.seed !== undefined ? { seed: request.seed } : {}),
        repeat_penalty: REPEAT_PENALTY,
        predict: MAX_REPLY_TOKENS,
      },
    });
    const requestId = run.requestId;

    if (onToken) {
      void (async () => {
        try {
          for await (const event of run.events) {
            if (event.type === "contentDelta") onToken(event.text);
          }
        } catch {
          // Surfaced via `run.final` below; avoids double-reporting and an unhandled rejection.
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

  /** Cancels by `requestId` - works for both an in-flight `load()` and `infer()`. Resolves (never rejects) for an unknown/settled/cancelled id, so no pre-check is needed. */
  async cancel(requestId: string): Promise<void> {
    await cancel({ requestId });
  }

  /** Model-wide cancel, needed for a delegated model: a `requestId` cancel reports success without stopping anything, but a `modelId` cancel is forwarded to the provider. */
  async cancelCompletions(modelId: string): Promise<void> {
    await cancel({ modelId, kind: "completion" });
  }

  /** Omits `modelId` on purpose, so the SDK removes the key's caches for every model, not just one. */
  async deleteCache(kvCacheKey: string): Promise<void> {
    await deleteCache({ kvCacheKey });
  }

  /** Thin wrapper over the SDK's `heartbeat()`, which throws when the provider is unreachable or the timeout elapses. */
  async heartbeat(delegate: { providerPublicKey: string; timeout: number }): Promise<void> {
    await heartbeat({ delegate });
  }

  /** Narrows the SDK's discriminated union (keyed on `isDelegated`) to the two fields this feature needs. */
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

/** Translates the SDK's cancellation errors (two different shapes for the same event - a real `InferenceCancelledError` instance, or a cancelled `loadModel()` carrying the same code) into `OperationCancelledError`; other errors pass through unchanged. */
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

/** Narrows on the exact "communicating with provider" message - the SDK reuses the generic `COMPLETION_FAILED` code for both this and a genuine completion failure, and `CompletionFailedError` isn't instanceof-able. */
function isProviderUnreachableError(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    err.code === SDK_SERVER_ERROR_CODES.COMPLETION_FAILED &&
    /communicating with provider/i.test(err.message)
  );
}

/** `url`/`rawSrc` pass through as-is; `registry` reconstructs `registry://<source>/<path>`. Shared by `load()`/`provision()`. */
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
