import { randomUUID } from "node:crypto";
import type { ModelManagementService } from "../../models/service/models.service.js";
import {
  isDelegatedProviderUnreachableError,
  ModelManagementError,
  OperationCancelledError,
} from "../../models/domain/errors.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  DelegateOptions,
  LoadedModelDelegationInfo,
  ModelSource,
} from "../../models/domain/types.js";
import { ConcurrencyLimiter } from "../../models/service/concurrencyLimiter.js";

const DEFAULT_CTX_SIZE = 4096;
const DEFAULT_MAX_CONCURRENCY = 1;

/** The slice of `ModelManagementService` a chat session needs - structural, so tests can pass a plain fake. */
export type QvacChatSessionService = Pick<
  ModelManagementService,
  "loadModel" | "chatComplete" | "cancel" | "cancelCompletions" | "unloadModel" | "getLoadedModelInfo"
>;

export interface QvacChatSessionOptions {
  service: QvacChatSessionService;
  modelSource: ModelSource;
  /** Defaults to 4096 when omitted. */
  ctxSize?: number;
  /** Opaque per-engine load config (e.g. a multimodal model's `projectionModelSrc`), merged as-is into the underlying engine's model config alongside `ctxSize`/`tools`. */
  engineConfig?: Record<string, unknown>;
  /** Whether `chatComplete()` calls made through this session use the SDK's KV cache. Defaults to enabled (`true`) when omitted. */
  kvCacheEnabled?: boolean;
  /** When set, routes this session's model load (and the inference that follows it) to a remote provider instead of running locally. */
  delegate?: DelegateOptions;
  /** Max `complete()` calls this session admits concurrently against the loaded model (continuous batching - see I.2's spike/results doc); extra calls queue FIFO. Defaults to 1 (today's sequential behavior) when omitted. */
  maxConcurrency?: number;
}

/** Owns the chat model's lifecycle on `ModelManagementService`: lazy load, local/delegated switching, mid-session recovery, cancellation, and the status `AgentService` reports. `complete` is what `ChatQVAC` calls per generation. */
export class QvacChatSession {
  private readonly service: QvacChatSessionService;
  private readonly modelSource: ModelSource;
  private readonly ctxSize: number;
  private readonly engineConfig?: Record<string, unknown>;
  private readonly kvCacheEnabled?: boolean;
  private readonly delegate?: DelegateOptions;
  private modelIdPromise?: Promise<string>;
  /** Cache backing `getCachedDelegationInfo()`, kept fresh by `getDelegationInfo()`, `switchTo()` and `recoverFromDelegationFailure()`. */
  private delegationInfo?: LoadedModelDelegationInfo;
  /** True during `recoverFromDelegationFailure()`/`switchTo("local")` so `getStatus()` can report "reconnecting"; not raised by `switchTo("delegated")`. */
  private recovering = false;
  /** Number of `switchTo()` calls in flight, either direction - backs `isBusy()`, so overlapping switches keep it `true` until the last one settles. */
  private switchesInFlight = 0;
  /** Bounds how many `complete()` calls run concurrently against the loaded model; extra calls queue (see `maxConcurrency`). */
  private readonly limiter: ConcurrencyLimiter;
  /** Caller requestId -> SDK-level requestId, per completion admitted past the limiter - lets `cancelActive()` target exactly one. A still-queued request has no entry yet (see `limiter.cancel()`). */
  private readonly activeRequestIds = new Map<string, string>();
  /** Same keys as `activeRequestIds` - the model each admitted completion is running on, needed to decide whether a model-wide `cancelCompletions()` fallback is safe (see `cancelActive()`). */
  private readonly activeModelIds = new Map<string, string>();
  /** Same keys as `activeRequestIds` - lets `cancelActive()` free that specific caller immediately, regardless of whether the underlying cancel RPC(s) actually stop anything in time. */
  private readonly completionAbandonSignals = new Map<string, (err: unknown) => void>();
  /** Shared by every concurrent `complete()` call whose provider died before it recovers, so N simultaneous failures reload the model once, not N times - see `complete()`'s catch block. */
  private recoveryPromise?: Promise<string>;
  /** The `requestId` of the `loadModel` call currently in flight, if any - lets `cancelLoad()` cancel it. */
  private loadRequestId?: string;
  /** Set while a load is in flight; `cancelLoad()` uses it to force `ensureModel()`'s pending promise to reject immediately. */
  private loadAbandonSignal?: { reject: (err: unknown) => void };

  constructor(options: QvacChatSessionOptions) {
    this.service = options.service;
    this.modelSource = options.modelSource;
    this.ctxSize = options.ctxSize ?? DEFAULT_CTX_SIZE;
    this.engineConfig = options.engineConfig;
    this.kvCacheEnabled = options.kvCacheEnabled;
    this.delegate = options.delegate;
    this.limiter = new ConcurrencyLimiter(options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
  }

  /**
   * Runs one completion, recovering once if the delegated provider died
   * before any token streamed (a provider dying mid-stream surfaces the
   * error as-is instead, to avoid duplicating/garbling output already
   * shown). Queues behind `limiter`; `request.requestId` (or a generated
   * fallback) is what `cancelActive()` targets. An arrow property so
   * `ChatQVAC` can hold it directly.
   */
  readonly complete = async (
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> => {
    const modelId = await this.ensureModel();
    const fullRequest: ChatCompletionRequest = { ...request, kvCacheEnabled: this.kvCacheEnabled };
    const limiterKey = request.requestId ?? randomUUID();
    const release = await this.limiter.acquire(limiterKey);

    let anyTokenEmitted = false;
    const trackedOnToken = onToken
      ? (textDelta: string) => {
          anyTokenEmitted = true;
          onToken(textDelta);
        }
      : undefined;

    try {
      return await this.runCancellable(
        limiterKey,
        modelId,
        this.service.chatComplete(modelId, fullRequest, trackedOnToken),
      );
    } catch (error) {
      if (anyTokenEmitted || !isDelegatedProviderUnreachableError(error)) throw error;
      const recoveredModelId = await this.recoverOnce();
      return await this.runCancellable(
        limiterKey,
        recoveredModelId,
        this.service.chatComplete(recoveredModelId, fullRequest, trackedOnToken),
      );
    } finally {
      this.activeRequestIds.delete(limiterKey);
      this.activeModelIds.delete(limiterKey);
      this.completionAbandonSignals.delete(limiterKey);
      release();
    }
  };

  /** Registers `pending` as admitted under `limiterKey` and races it against `cancelActive(limiterKey)`'s abandon signal. */
  private runCancellable(
    limiterKey: string,
    modelId: string,
    pending: Promise<ChatCompletionResult> & { requestId: string },
  ): Promise<ChatCompletionResult> {
    this.activeRequestIds.set(limiterKey, pending.requestId);
    this.activeModelIds.set(limiterKey, modelId);
    const abandoned = new Promise<never>((_, reject) => {
      this.completionAbandonSignals.set(limiterKey, reject);
    });
    return Promise.race([pending, abandoned]);
  }

  /**
   * Cancels the `complete()` call for `requestId`; no-op if unknown/settled.
   * A still-queued call is rejected via `limiter` directly. An admitted
   * call's abandon signal frees the caller immediately; `service.cancel()`
   * alone can't stop a *delegated* completion (the SDK reports success
   * locally without forwarding to the provider), so `cancelCompletions(modelId)`
   * also runs, but only when no sibling completion is active on that model -
   * otherwise it would cancel them too.
   */
  async cancelActive(requestId: string): Promise<void> {
    if (this.limiter.cancel(requestId)) return;
    const sdkRequestId = this.activeRequestIds.get(requestId);
    if (!sdkRequestId) return;
    const modelId = this.activeModelIds.get(requestId);
    this.completionAbandonSignals.get(requestId)?.(
      new ModelManagementError("cancel", "Operation cancelled", new OperationCancelledError(requestId)),
    );
    await this.service.cancel(sdkRequestId);
    const hasActiveSiblingOnSameModel = [...this.activeModelIds.entries()].some(
      ([key, activeModelId]) => key !== requestId && activeModelId === modelId,
    );
    if (this.delegate && modelId && !hasActiveSiblingOnSameModel) {
      await this.service.cancelCompletions(modelId);
    }
  }

  /** Coalesces concurrent recovery attempts into one reload instead of each call unloading/reloading independently. */
  private recoverOnce(): Promise<string> {
    if (!this.recoveryPromise) {
      this.recoveryPromise = this.recoverFromDelegationFailure().finally(() => {
        this.recoveryPromise = undefined;
      });
    }
    return this.recoveryPromise;
  }

  /**
   * Cancels the in-flight `loadModel` call, if any. `service.cancel()` is
   * best-effort during a delegated load's connect phase (it may report
   * success without interrupting anything), so `loadAbandonSignal` also
   * rejects to guarantee the caller isn't stuck past `DelegateOptions.timeout`.
   */
  async cancelLoad(): Promise<void> {
    if (!this.loadRequestId) return;
    const requestId = this.loadRequestId;
    await this.service.cancel(requestId).catch(() => {});
    this.loadAbandonSignal?.reject(
      new ModelManagementError("cancel", "Operation cancelled", new OperationCancelledError(requestId)),
    );
  }

  /** Races the real load against `cancelLoad()`'s abandon signal so a caller is never stuck past a cancel request; the load itself keeps running in the background either way. */
  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.startLoad(this.delegate).catch((error: unknown) => {
        this.modelIdPromise = undefined;
        throw error;
      });
    }
    return this.modelIdPromise;
  }

  /** Shared load path for `ensureModel()`/`switchTo()`; doesn't touch `modelIdPromise` itself - each caller decides how to cache/clear the result. */
  private startLoad(delegate: DelegateOptions | undefined): Promise<string> {
    const pending = this.service.loadModel(this.modelSource, {
      ctxSize: this.ctxSize,
      // Tool-call parsing needs tools:true at load time even before the request carries any - can't be deferred.
      tools: true,
      engineConfig: this.engineConfig,
      delegate,
    });
    this.loadRequestId = pending.requestId;
    const abandoned = new Promise<never>((_, reject) => {
      this.loadAbandonSignal = { reject };
    });
    return Promise.race([pending.then((loaded) => loaded.modelId), abandoned]).finally(() => {
      this.loadRequestId = undefined;
      this.loadAbandonSignal = undefined;
    });
  }

  /** Whether the loaded model runs remotely or locally; undefined until loaded, or if no `delegate` is configured. Best-effort (resolves undefined on introspection failure) and cached - refreshed after a mid-session recovery so the cache never goes stale. */
  async getDelegationInfo(): Promise<LoadedModelDelegationInfo | undefined> {
    if (!this.delegate) {
      this.delegationInfo = undefined;
      return undefined;
    }
    const modelId = await this.ensureModel();
    this.delegationInfo = await this.service.getLoadedModelInfo(modelId).catch(() => undefined);
    return this.delegationInfo;
  }

  /** The context window, in tokens, the chat model is loaded with - the same `ctxSize` `startLoad()` passes to `loadModel`, so the context budget measures against what the model really has. */
  get contextWindowTokens(): number {
    return this.ctxSize;
  }

  /** Synchronous snapshot of the last `getDelegationInfo()` result, so a frequently-polled status endpoint avoids an async round-trip per poll. */
  getCachedDelegationInfo(): LoadedModelDelegationInfo | undefined {
    return this.delegationInfo;
  }

  /** Synchronous snapshot of whether a delegation-recovery reload is currently in flight. */
  isRecovering(): boolean {
    return this.recovering;
  }

  /** True while any completion (active or queued), a load, a recovery, or a `switchTo()` is in flight - queued completions count too since they already captured the `modelId` a switch would unload out from under them. */
  isBusy(): boolean {
    return (
      this.activeRequestIds.size > 0 ||
      this.limiter.queuedCount > 0 ||
      this.loadRequestId !== undefined ||
      this.recovering ||
      this.switchesInFlight > 0
    );
  }

  /**
   * Proactively moves the model between local and the configured delegate
   * (the health-check counterpart to `recoverFromDelegationFailure()`).
   * `"local"` starts immediately, skipping a connect timeout against a
   * known-down provider. `"delegated"` falls back to local within the same
   * call if the provider answers but can't serve the load. Sets
   * `modelIdPromise` synchronously (before any await) so a request arriving
   * mid-switch awaits this same load instead of starting a second one; only
   * `"local"` raises `isRecovering()`.
   */
  async switchTo(mode: "local" | "delegated"): Promise<string> {
    if (mode === "delegated" && !this.delegate) {
      throw new Error("Cannot switch to a delegated model: no delegate is configured");
    }
    const staleModelIdPromise = this.modelIdPromise;
    this.switchesInFlight += 1;
    if (mode === "local") this.recovering = true;
    const switching = (async () => {
      const staleModelId = await staleModelIdPromise?.catch(() => undefined);
      if (staleModelId) {
        await this.service.unloadModel(staleModelId).catch(() => {});
      }
      if (mode === "local") return this.startLoad(undefined);
      return this.startLoad(this.delegate).catch(() => this.startLoad(undefined));
    })();
    this.modelIdPromise = switching;
    try {
      const modelId = await switching;
      this.delegationInfo = await this.service.getLoadedModelInfo(modelId).catch(() => undefined);
      return modelId;
    } catch (error) {
      if (this.modelIdPromise === switching) this.modelIdPromise = undefined;
      this.delegationInfo = undefined;
      throw error;
    } finally {
      this.switchesInFlight -= 1;
      if (mode === "local") this.recovering = false;
    }
  }

  /**
   * Called when a completion fails because the delegated provider died
   * mid-session (the SDK's own fallback-to-local only applies at load
   * time). Must unload the stale model before reloading, not just for
   * cleanup: a plain reload would find the model id still registered as
   * delegated and silently no-op, leaving every later request pointed at
   * the same dead provider. Refreshes the cached delegation info once the
   * reload settles.
   */
  private async recoverFromDelegationFailure(): Promise<string> {
    this.recovering = true;
    try {
      const staleModelId = await this.modelIdPromise;
      this.modelIdPromise = undefined;
      if (staleModelId) {
        await this.service.unloadModel(staleModelId).catch(() => {});
      }
      const modelId = await this.ensureModel();
      await this.getDelegationInfo();
      return modelId;
    } finally {
      this.recovering = false;
    }
  }
}
