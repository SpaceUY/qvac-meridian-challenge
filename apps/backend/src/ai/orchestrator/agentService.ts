import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import type { Citation, RetrievedChunk } from "../../rag/domain/types.js";
import { selectCitations } from "./citationPolicy.js";
import { ChatQVAC } from "@space-uy/qvac-langgraph";
import { QvacChatSession } from "./qvacChatSession.js";
import { createGraph } from "./graph.js";
import { State, type GenerationOptions } from "./domain.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";
import type { ModelManagementService } from "../../models/service/models.service.js";
import type { SupportedImageMimeType } from "../../models/domain/types.js";
import { isCancellationError, ModelManagementError, OperationCancelledError } from "../../models/domain/errors.js";
import type { LoadedModelDelegationInfo } from "../../models/domain/types.js";
import {
  LLM_MODELS_BY_TIER,
  WHISPER_MODEL_NAMES_BY_TIER,
  TTS_MODEL_NAMES_BY_TIER,
  resolveEngineConfig,
} from "../../config/models.config.js";
import { RESOURCE_TIER, type ResourceTier } from "../../config/resourceTier.js";
import {
  DELEGATE_CONFIG,
  HEARTBEAT_CONFIG,
} from "../../config/delegate.config.js";
import {
  ProviderHealthMonitor,
  type DesiredProviderMode,
} from "./providerHealthMonitor.js";
import type { ProviderHealth } from "./providerHealth.js";
import { reconcileProviderMode } from "./reconcileProviderMode.js";
import { measureContextUsage, type ContextUsage } from "./contextBudget.js";
import { CONTEXT_BUDGET_THRESHOLD } from "../../config/context.config.js";

export type AgentStatus = "idle" | "loading" | "ready" | "error";

export interface AgentStatusPayload {
  status: AgentStatus;
  error?: string;
  model: { name: string; quantization: string };
  /** The resource tier this process resolved at startup (`resourceTier.ts`) - the same value every tiered consumer (chat, TTS, STT) is using right now. */
  hardwareTier: ResourceTier;
  /** Display name of the Whisper model resolved for this tier - not necessarily loaded into memory yet (STT loads lazily, on first use), just which one this process would load. */
  sttModel: string;
  /** Display name of the TTS model resolved for this tier - same "resolved, not necessarily loaded yet" caveat as sttModel. */
  ttsModel: string;
  /** Present once known (after a successful `preload()`) - whether the chat model is running on a remote provider or locally. Absent while idle/loading/error, or if delegation status couldn't be confirmed. */
  delegation?: LoadedModelDelegationInfo;
  /** Whether a delegation-recovery reload is in flight right now (see `QvacChatSession.isRecovering()`). Always present (never `undefined`) - simpler for the frontend to read than a third "unknown" state, and it's meaningfully `false` even when no delegate is configured at all. */
  recovering: boolean;
  /** Present only when a delegate is configured and the provider health monitor has started (after a successful `preload()`): whether the provider is answering heartbeats. */
  providerHealth?: ProviderHealth;
}

function describeMode({
  isDelegated,
}: LoadedModelDelegationInfo): "delegated" | "local" {
  return isDelegated ? "delegated" : "local";
}

export interface ConversationMessage {
  role: "user" | "assistant";
  message: string;
  images?: { mimeType: SupportedImageMimeType; data: Buffer }[];
}

function toLangChainMessage({
  role,
  message,
  images,
}: ConversationMessage): HumanMessage | AIMessage {
  if (role === "assistant") return new AIMessage(message);
  if (!images?.length) return new HumanMessage(message);

  return new HumanMessage({
    content: [
      { type: "text", text: message },
      ...images.map((image) => ({
        type: "image" as const,
        mimeType: image.mimeType,
        data: image.data,
      })),
    ],
  });
}

export interface InvokeResult {
  answer: string;
  /** The model's raw reasoning/thinking trace for this reply, when the runtime captured one. */
  thinkingText?: string;
  /** RAG chunks retrieved for this turn and passed to the model as grounding context. */
  chunks: RetrievedChunk[];
  /** Names of the tools (e.g. "lookup_stock", "list_documents") the agent actually invoked and got a result from during this turn, deduplicated, in no particular order. Empty when the answer used only RAG/the model's own reasoning. */
  toolsUsed: string[];
  /** Source documents for `answer`, in the evaluator's `{ file, score }` shape. Empty when the answer wasn't grounded - see `selectCitations`. */
  citations: Citation[];
  /** How full this conversation's context window is after this turn (`measureContextUsage`). Absent when the runtime reported no token stats. */
  context?: ContextUsage;
}

/**
 * Preloads a QVAC chat model and compiles the stock-assistant graph around
 * it once, so repeated `invoke()` calls reuse both instead of rebuilding
 * them per request. Also tracks its own load status so an HTTP layer has
 * something real to report (see `chat.router.ts`).
 */
export class AgentService {
  private readonly chatModel: ChatQVAC;
  private readonly chatSession: QvacChatSession;
  private readonly graph: ReturnType<typeof createGraph>;
  private readonly modelInfo: { name: string; quantization: string };
  private readonly sttModel: string;
  private readonly ttsModel: string;
  private status: AgentStatus = "idle";
  private statusError: string | undefined;
  //private readonly corpusContext: Promise<string>;
  /** `requestId`s of `invoke()` calls still in flight - lets `cancel()` reject an unknown/already-settled `requestId` as a safe no-op. */
  private readonly pendingRequests = new Set<string>();
  /**
   * `requestId`s that `cancel()` reached while still pending. An invoke
   * makes several LLM calls (tool call, then answer); a cancel that lands
   * between them finds no call to stop, so this is what keeps the next one
   * from starting. Cleared when the invoke settles.
   */
  private readonly cancelledRequests = new Set<string>();
  /** Only set when a delegate is configured, once `preload()` has succeeded; see `startHealthMonitor()`. */
  private healthMonitor?: ProviderHealthMonitor;
  /** Set once a proactive switch back to the provider has been attempted. Cleared when the provider's health calls for local again, and whenever a check observes the model running on the provider - so a provider that answers heartbeats but cannot serve the model gets one attempt per down->up transition instead of a reload every tick, while a model that later drifts off the provider still gets a fresh attempt. */
  private redelegationAttempted = false;

  /** `tier` defaults to the process-wide `RESOURCE_TIER`, overridable for tests. */
  constructor(
    private readonly service: ModelManagementService,
    ragService: RagRetrievalService,
    documentRepository: DocumentRepository,
    private readonly tier: ResourceTier = RESOURCE_TIER,
  ) {
    const selectedModel = LLM_MODELS_BY_TIER[this.tier];
    const { modelSource, modelName, quantization, temperature, ctxSize, kvCacheEnabled, maxConcurrency } =
      selectedModel;
    this.modelInfo = { name: modelName, quantization };
    this.sttModel = WHISPER_MODEL_NAMES_BY_TIER[this.tier];
    this.ttsModel = TTS_MODEL_NAMES_BY_TIER[this.tier];
    this.chatSession = new QvacChatSession({
      service,
      modelSource,
      ctxSize,
      engineConfig: resolveEngineConfig(selectedModel),
      kvCacheEnabled,
      delegate: DELEGATE_CONFIG,
      maxConcurrency,
    });
    this.chatModel = new ChatQVAC({
      complete: (request, onToken) => {
        // A cancelled invoke never starts another LLM call (see cancelledRequests).
        if (request.requestId && this.cancelledRequests.has(request.requestId)) {
          return Promise.reject(
            new ModelManagementError("cancel", "Operation cancelled", new OperationCancelledError(request.requestId)),
          );
        }
        return this.chatSession.complete(request, onToken);
      },
      temperature,
    });
    this.graph = createGraph(this.chatModel, ragService, documentRepository);
  }

  /**
   * The current load status — polled by `GET /api/chat/status` (Task 2).
   * Also carries a model snapshot for the engine panel. `delegation` is
   * read live off `chatSession.getCachedDelegationInfo()` rather than a
   * snapshot taken once at `preload()` time, so it reflects a mid-session
   * recovery (the chat model falling back to local after its delegated
   * provider died) instead of staying stuck on stale "still delegated"
   * status forever.
   */
  getStatus(): AgentStatusPayload {
    const delegation = this.chatSession.getCachedDelegationInfo();
    return {
      status: this.status,
      ...(this.statusError ? { error: this.statusError } : {}),
      model: this.modelInfo,
      hardwareTier: this.tier,
      sttModel: this.sttModel,
      ttsModel: this.ttsModel,
      ...(delegation ? { delegation } : {}),
      recovering: this.chatSession.isRecovering(),
      ...(this.healthMonitor
        ? { providerHealth: this.healthMonitor.getHealth() }
        : {}),
    };
  }

  /** Idempotent: a second call while `loading`/`ready` does nothing new. */
  async preload(): Promise<void> {
    if (this.status === "loading" || this.status === "ready") return;
    this.status = "loading";
    this.statusError = undefined;
    try {
      await this.chatSession.ensureModel();
      await this.chatSession.getDelegationInfo();
      this.status = "ready";
      this.startHealthMonitor();
    } catch (err) {
      // A cancelled load isn't a genuine failure - go back to "idle" so a
      // caller can start loading again, rather than getting stuck on "error".
      if (isCancellationError(err)) {
        this.status = "idle";
      } else {
        this.status = "error";
        this.statusError = err instanceof Error ? err.message : String(err);
      }
      throw err;
    }
  }

  /**
   * Starts polling the delegated provider's heartbeat once the chat model
   * has loaded - no-op without a configured delegate, and idempotent. A
   * model that fell back to local at preload starts as `down`, so the
   * monitor notices the provider coming back and re-delegates. Ticks are
   * skipped while a chat is in flight (any pending `invoke()`, streaming
   * included), so a heartbeat never probes the connection a completion is
   * using.
   */
  private startHealthMonitor(): void {
    if (!DELEGATE_CONFIG || this.healthMonitor) return;
    const { providerPublicKey } = DELEGATE_CONFIG;
    const startedLocal =
      this.chatSession.getCachedDelegationInfo()?.isDelegated === false;
    this.healthMonitor = new ProviderHealthMonitor({
      intervalMs: HEARTBEAT_CONFIG.intervalMs,
      timeoutMs: HEARTBEAT_CONFIG.timeoutMs,
      initialState: startedLocal ? "down" : "up",
      heartbeat: () =>
        this.service.heartbeat({
          providerPublicKey,
          timeout: HEARTBEAT_CONFIG.timeoutMs,
        }),
      shouldSkipTick: () =>
        this.chatSession.isBusy() || this.pendingRequests.size > 0,
      reconcile: (desired) => this.reconcileProviderMode(desired),
    });
    this.healthMonitor.start();
  }

  /** `reconcileProviderMode()` against the chat model, deciding from the model's live mode (see `readLiveDelegationInfo()`), with at most one `switchTo("delegated")` per attempt budget (see `redelegationAttempted`). */
  private reconcileProviderMode(desired: DesiredProviderMode): Promise<void> {
    if (desired === "local") this.redelegationAttempted = false;
    return reconcileProviderMode(
      {
        isBusy: () => this.chatSession.isBusy(),
        getDelegationInfo: () => this.readLiveDelegationInfo(),
        switchTo: async (mode) => {
          if (mode === "local") {
            await this.chatSession.switchTo(mode);
            return;
          }
          if (this.redelegationAttempted) return;
          this.redelegationAttempted = true;
          await this.redelegate();
        },
      },
      desired,
    );
  }

  /**
   * Re-reads the chat model's real mode from the SDK. If it differs from
   * what `QvacChatSession` last reported, something changed the model outside a
   * tracked switch - logged, since nothing else reveals it (never logs the
   * provider's key). A model observed on the provider restores the
   * re-delegation budget, so the next divergence gets a fresh attempt.
   */
  private async readLiveDelegationInfo(): Promise<
    LoadedModelDelegationInfo | undefined
  > {
    const reported = this.chatSession.getCachedDelegationInfo();
    const live = await this.chatSession.getDelegationInfo();
    if (reported && live && reported.isDelegated !== live.isDelegated) {
      console.warn(
        `[provider-health] the chat model's mode changed outside a tracked switch: it was reported as ${describeMode(reported)}, the SDK now reports ${describeMode(live)}`,
      );
    }
    if (live?.isDelegated) this.redelegationAttempted = false;
    return live;
  }

  /**
   * One switch back to the provider, logged at both ends: the attempt can
   * silently end up on a local model (the provider answers heartbeats but
   * cannot serve the load), and since it is not retried until the provider
   * recovers again, the log is the only place that outcome is visible.
   * A successful attempt restores the attempt budget right away, so a drift
   * before the next check has observed the model is still corrected.
   * Never logs the provider's key.
   */
  private async redelegate(): Promise<void> {
    console.info(
      "[provider-health] re-delegation attempt started: provider is answering heartbeats again",
    );
    try {
      await this.chatSession.switchTo("delegated");
    } catch (error) {
      console.error(
        "[provider-health] re-delegation attempt failed; the chat model is not loaded until the next tick or chat request",
        error,
      );
      throw error;
    }
    if (this.chatSession.getCachedDelegationInfo()?.isDelegated) {
      this.redelegationAttempted = false;
      console.info(
        "[provider-health] re-delegation attempt finished: the chat model is running on the provider",
      );
      return;
    }
    console.info(
      "[provider-health] re-delegation attempt finished: the chat model is running locally (the provider could not serve the load); not retried until the provider recovers again",
    );
  }

  /**
   * Cancels the model load started by `preload()`, if one is currently in
   * flight. Safe to call when nothing is loading - a no-op, same
   * convention as `ModelManagementService.cancel()`.
   */
  async cancelPreload(): Promise<void> {
    await this.chatSession.cancelLoad();
  }

  /**
   * Sends a conversation history through the graph, returns the assistant's
   * reply text and thinking trace. `options` overrides this turn's
   * `temperature`/`seed` (Req 6.1.3), falling back to `ChatQVAC`'s own
   * constructor default when omitted. Pass `onToken` to receive the final
   * reply's text as it's generated, rather than only once this resolves.
   *
   * Not `async`: the returned promise carries `requestId` synchronously so
   * a caller can pass it to `cancel()` while the invoke is still running -
   * same convention as `ModelManagementService.loadModel()`/`infer()`.
   */
  invoke(
    messages: ConversationMessage[],
    options?: GenerationOptions,
    onToken?: (textDelta: string) => void,
  ): Promise<InvokeResult> & { requestId: string } {
    const requestId = randomUUID();
    this.pendingRequests.add(requestId);

    const result = this.runInvoke(messages, options, requestId, onToken).finally(() => {
      this.pendingRequests.delete(requestId);
      this.cancelledRequests.delete(requestId);
    });
    return Object.assign(result, { requestId });
  }

  /**
   * Cancels the chat completion currently in flight (or still queued behind
   * the tier's concurrency limit) for `requestId`, if it's still pending -
   * rejecting the `invoke()` promise it belongs to, without disturbing any
   * other concurrently in-flight or queued `invoke()`. Safe to call with an
   * unknown or already-settled `requestId`, same no-op convention as
   * `ModelManagementService.cancel()`.
   *
   * `requestId` is threaded through the graph's state down to whatever
   * `QvacChatSession.complete()` call this `invoke()` is currently making
   * (see `runInvoke()`/`graph.ts`'s `generateReply()`), so `cancelActive()`
   * can target exactly that call even while other tiers' concurrency allows
   * several to run at once.
   */
  async cancel(requestId: string): Promise<void> {
    if (!this.pendingRequests.has(requestId)) return;
    this.cancelledRequests.add(requestId);
    await this.chatSession.cancelActive(requestId);
  }

  /** Deletes the KV cache of a chat session - `sessionId` doubles as the SDK's `kvCache` key (see `QvacRuntimeAdapter.chatComplete`). Safe for a session that has no cache. */
  async deleteSessionCache(sessionId: string): Promise<void> {
    await this.service.deleteCache(sessionId);
  }

  private async runInvoke(
    messages: ConversationMessage[],
    options: GenerationOptions | undefined,
    requestId: string,
    onToken?: (textDelta: string) => void,
  ): Promise<InvokeResult> {
    const langchainMessages = messages.map(toLangChainMessage);

    const stream = await this.graph.stream(
      {
        messages: langchainMessages,
        temperature: options?.temperature,
        seed: options?.seed,
        sessionId: options?.sessionId,
        requestId,
      },
      { streamMode: ["messages", "values"] },
    );

    let finalState: typeof State.State | undefined;
    let streamedAnyToken = false;
    for await (const [mode, payload] of stream) {
      if (mode === "messages") {
        const [chunk] = payload;
        if (AIMessage.isInstance(chunk) && chunk.text) {
          streamedAnyToken = true;
          onToken?.(chunk.text);
        }
      } else {
        finalState = payload;
      }
    }

    const lastAIMessage = [...(finalState?.messages ?? [])]
      .reverse()
      .find((message): message is AIMessage => AIMessage.isInstance(message));

    const answer = lastAIMessage?.text ?? "";
    // Safety net only: "messages" mode also emits the messages a node returns
    // (not just model tokens), so the insufficient-context fallback and any
    // hidden reply (see graph.ts's buildLlmNode) already reached onToken
    // above. This covers a reply that somehow produced no stream event.
    if (!streamedAnyToken && answer) onToken?.(answer);

    const thinkingText = lastAIMessage?.additional_kwargs.thinkingText;
    const chunks = finalState?.chunks ?? [];
    const toolsUsed = [
      ...new Set(
        (finalState?.messages ?? [])
          .filter((message): message is ToolMessage =>
            ToolMessage.isInstance(message),
          )
          .filter((message) => message.status !== "error")
          .map((message) => message.name)
          .filter(
            (name): name is string =>
              typeof name === "string" && name.length > 0,
          ),
      ),
    ];

    const context = measureContextUsage(
      finalState?.completionStats,
      this.chatSession.contextWindowTokens,
      CONTEXT_BUDGET_THRESHOLD,
    );

    return {
      answer,
      thinkingText: typeof thinkingText === "string" ? thinkingText : undefined,
      chunks,
      toolsUsed,
      citations: selectCitations(answer, chunks),
      ...(context ? { context } : {}),
    };
  }
}
