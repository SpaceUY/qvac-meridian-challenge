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

const DEFAULT_CTX_SIZE = 4096;

/** The slice of `ModelManagementService` a chat session needs - structural, so tests can pass a plain fake. */
export type QvacChatSessionService = Pick<
  ModelManagementService,
  "loadModel" | "chatComplete" | "cancel" | "unloadModel" | "getLoadedModelInfo"
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
}

/**
 * Owns the chat model's lifecycle on top of `ModelManagementService`: lazy
 * load, switching between local and delegated, recovery when a delegated
 * provider dies mid-session, cancellation, and the busy/recovering/delegation
 * state `AgentService` reports. `complete` is what `ChatQVAC` (the LangChain
 * adapter in `qvac-langgraph`) calls for every generation.
 */
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
  /** `true` for the duration of a `recoverFromDelegationFailure()` or `switchTo("local")` call - lets `AgentService.getStatus()` report "reconnecting" instead of the frontend inferring it 60s late from a state change that already finished. Not raised by `switchTo("delegated")`: a move back to the provider is not a reconnect after a failure. */
  private recovering = false;
  /** Number of `switchTo()` calls in flight, either direction - backs `isBusy()`, so overlapping switches keep it `true` until the last one settles. */
  private switchesInFlight = 0;
  /** The `requestId` of the `chatComplete` call currently in flight, if any - lets `cancelActive()` cancel it. */
  private activeRequestId?: string;
  /** The `requestId` of the `loadModel` call currently in flight, if any - lets `cancelLoad()` cancel it. */
  private loadRequestId?: string;
  /**
   * Set while a load is in flight; `cancelLoad()` uses it to force
   * `ensureModel()`'s pending promise to reject immediately. See
   * `cancelLoad()`'s doc comment for why this exists alongside the
   * service-level `cancel()` call.
   */
  private loadAbandonSignal?: { reject: (err: unknown) => void };

  constructor(options: QvacChatSessionOptions) {
    this.service = options.service;
    this.modelSource = options.modelSource;
    this.ctxSize = options.ctxSize ?? DEFAULT_CTX_SIZE;
    this.engineConfig = options.engineConfig;
    this.kvCacheEnabled = options.kvCacheEnabled;
    this.delegate = options.delegate;
  }

  /**
   * Runs one chat completion against the (lazily loaded) model, recovering
   * once if it fails specifically because the delegated provider died
   * mid-session - reloads (falling back to local) and retries against the
   * new model. Any other failure, or a second failure after recovery,
   * propagates as-is: this is a one-shot recovery, not a retry loop.
   *
   * Recovery is only safe before the caller has seen any output - a
   * provider dying after tokens already streamed can't be silently retried
   * without duplicating/garbling what's already shown, so that case
   * surfaces the error as-is instead. A call without `onToken` never
   * streams, so it is always eligible.
   *
   * An arrow property so it can be handed to `ChatQVAC` directly.
   */
  readonly complete = async (
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> => {
    const modelId = await this.ensureModel();
    const fullRequest: ChatCompletionRequest = { ...request, kvCacheEnabled: this.kvCacheEnabled };

    let anyTokenEmitted = false;
    const trackedOnToken = onToken
      ? (textDelta: string) => {
          anyTokenEmitted = true;
          onToken(textDelta);
        }
      : undefined;

    const pending = this.service.chatComplete(modelId, fullRequest, trackedOnToken);
    this.activeRequestId = pending.requestId;
    try {
      return await pending;
    } catch (error) {
      if (anyTokenEmitted || !isDelegatedProviderUnreachableError(error)) throw error;
      const recoveredModelId = await this.recoverFromDelegationFailure();
      const retryPending = this.service.chatComplete(recoveredModelId, fullRequest, trackedOnToken);
      this.activeRequestId = retryPending.requestId;
      return await retryPending;
    } finally {
      this.activeRequestId = undefined;
    }
  };

  /**
   * Cancels the `chatComplete` call currently in flight on this session, if
   * any - used by a host's cancel endpoint to stop a running generation.
   * No-op when nothing is in flight (e.g. it already settled).
   */
  async cancelActive(): Promise<void> {
    if (!this.activeRequestId) return;
    await this.service.cancel(this.activeRequestId);
  }

  /**
   * Cancels the `loadModel` call currently in flight on this session, if
   * any - used by a host's cancel-preload path to stop a running
   * `preload()`. No-op when nothing is in flight.
   *
   * `service.cancel()` is best-effort here, not a guarantee: a delegated
   * load's connection-establishment phase can fail to register with the
   * underlying runtime's request-cancellation registry at all, so
   * `cancel()` during that phase may just report success without
   * interrupting anything - the connection attempt keeps running until it
   * times out on its own (`DelegateOptions.timeout`). Rejecting
   * `loadAbandonSignal` guarantees the caller isn't stuck waiting that
   * long regardless of whether the service-level cancel actually took effect.
   */
  async cancelLoad(): Promise<void> {
    if (!this.loadRequestId) return;
    const requestId = this.loadRequestId;
    await this.service.cancel(requestId).catch(() => {});
    this.loadAbandonSignal?.reject(
      new ModelManagementError("cancel", "Operation cancelled", new OperationCancelledError(requestId)),
    );
  }

  /**
   * Races the real load against a manually-triggered "abandon" signal
   * (see `cancelLoad()`) so a caller is never stuck waiting on this
   * promise longer than a cancel request, even when the underlying service
   * can't actually interrupt the operation. The real load keeps running
   * in the background either way - this only stops the caller from
   * waiting on it.
   */
  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.startLoad(this.delegate).catch((error: unknown) => {
        this.modelIdPromise = undefined;
        throw error;
      });
    }
    return this.modelIdPromise;
  }

  /**
   * The load itself, shared by `ensureModel()` and `switchTo()`: races the
   * real load against `cancelLoad()`'s abandon signal and clears the
   * in-flight bookkeeping when it settles. Deliberately does not touch
   * `modelIdPromise` - each caller decides how the resulting promise is
   * cached (and cleared on failure).
   */
  private startLoad(delegate: DelegateOptions | undefined): Promise<string> {
    const pending = this.service.loadModel(this.modelSource, {
      ctxSize: this.ctxSize,
      // The llamacpp-completion addon only parses tool calls when the model
      // was loaded with `tools: true` *and* the request carries tools -
      // load-time opt-in is required even though it's a no-op without the
      // latter, so this can't be deferred to the request.
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

  /**
   * Whether the currently loaded model is running on a remote provider or
   * locally - `undefined` until a model has loaded, or if no `delegate`
   * was configured at all (a non-delegating load is always local, so
   * there's nothing to query). Best-effort: if the introspection query
   * itself fails, resolves `undefined` rather than throwing, so a caller
   * never has its own success/failure hinge on this - the model is either
   * loaded and usable or it isn't, independent of whether its delegation
   * status could be confirmed.
   *
   * Caches its result (see `getCachedDelegationInfo()`) - also refreshed
   * by `recoverFromDelegationFailure()` after a mid-session recovery, so
   * the cache never goes stale after the model that was originally
   * delegated falls back to running locally.
   */
  async getDelegationInfo(): Promise<LoadedModelDelegationInfo | undefined> {
    if (!this.delegate) {
      this.delegationInfo = undefined;
      return undefined;
    }
    const modelId = await this.ensureModel();
    this.delegationInfo = await this.service.getLoadedModelInfo(modelId).catch(() => undefined);
    return this.delegationInfo;
  }

  /**
   * Synchronous snapshot of the last `getDelegationInfo()` result. Exists
   * so a host's status endpoint - itself synchronous, if it's polled by a
   * frontend every second - can report current delegation status without
   * an async round-trip (and a service call) on every poll.
   */
  getCachedDelegationInfo(): LoadedModelDelegationInfo | undefined {
    return this.delegationInfo;
  }

  /** Synchronous snapshot of whether a delegation-recovery reload is currently in flight. See the `recovering` field's doc comment. */
  isRecovering(): boolean {
    return this.recovering;
  }

  /**
   * `true` while a completion, a load, a recovery reload or a `switchTo()`
   * is in flight. A host uses it to defer a proactive `switchTo()` until
   * nothing would be interrupted.
   */
  isBusy(): boolean {
    return (
      this.activeRequestId !== undefined ||
      this.loadRequestId !== undefined ||
      this.recovering ||
      this.switchesInFlight > 0
    );
  }

  /**
   * Proactively moves the model between running locally and running on the
   * configured delegate - the health-check counterpart to the reactive
   * `recoverFromDelegationFailure()`. Callers should check `isBusy()`
   * first; this does not wait for an in-flight completion.
   *
   * `"local"` loads with no `delegate`, so it starts immediately instead
   * of waiting out a connect timeout against a provider that is known to be
   * down. `"delegated"` loads with the configured `delegate` (still
   * `fallbackToLocal`); if that load rejects anyway (e.g. the provider
   * answers but fails to load the model, which the service does not fall
   * back from), it loads locally within the same call, so the old model is
   * never left unloaded just because the provider could not serve it.
   * Only `"local"` raises `isRecovering()`; both directions count towards
   * `isBusy()`.
   *
   * `modelIdPromise` is set to the switch itself synchronously, before any
   * `await`, so a chat request arriving mid-switch awaits this load
   * instead of starting a second one. The old model is unloaded first for
   * the same reason `recoverFromDelegationFailure()` does (see its doc
   * comment). On failure the cached promise and delegation info are
   * cleared: the old model is already gone, so the next `ensureModel()`
   * must reload rather than reuse a stale id.
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
   * Called when a chat completion fails because the delegated model's
   * provider died mid-session. A typical service's own fallback-to-local
   * behavior only applies at load time, so an already-loaded delegated
   * model has no service-level recovery of its own once its provider goes
   * down.
   *
   * Unloading the stale model *before* reloading is required, not just
   * cleanup: many local-load implementations only register a model when
   * it isn't already registered under that same model id - a plain reload
   * would find the id still registered (as delegated, pointing at the dead
   * provider) and silently no-op, leaving the model delegated forever and
   * turning every later request into another doomed connection attempt to
   * the same dead provider. `unloadModel()` on a delegated model is
   * expected to unregister it synchronously before even trying to notify
   * the (unreachable) provider, so this is safe and fast even with the
   * provider down. Best-effort: if the unload itself fails, still attempt
   * the reload - the stale entry may cause another no-op fallback, but
   * that's no worse than not trying.
   *
   * Also refreshes `getCachedDelegationInfo()`'s cache once the reload
   * settles - without this, a host's status endpoint would keep reporting
   * the pre-recovery "running on remote peer" snapshot from the original
   * preload forever, even after the model is genuinely running locally
   * again.
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
