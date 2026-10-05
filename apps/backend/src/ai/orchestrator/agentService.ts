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
import { isCancellationError } from "../../models/domain/errors.js";
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
  /** Resource tier resolved at startup; shared by every tiered consumer (chat, TTS, STT). */
  hardwareTier: ResourceTier;
  /** Whisper model resolved for this tier; may not be loaded yet (STT loads lazily). */
  sttModel: string;
  /** TTS model resolved for this tier; same lazy-load caveat as sttModel. */
  ttsModel: string;
  /** Known once preload() succeeds; absent while idle/loading/error or if unconfirmed. */
  delegation?: LoadedModelDelegationInfo;
  /** Whether a delegation-recovery reload is in flight; always present, never undefined. */
  recovering: boolean;
  /** Present only once a delegate is configured and health monitoring has started. */
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
  /** Raw reasoning trace, when the runtime captured one. */
  thinkingText?: string;
  /** RAG chunks retrieved for this turn and passed to the model as grounding context. */
  chunks: RetrievedChunk[];
  /** Tools invoked successfully this turn, deduplicated, unordered; empty if none were called. */
  toolsUsed: string[];
  /** Source documents for `answer`, in the evaluator's `{ file, score }` shape; empty if ungrounded - see `selectCitations`. */
  citations: Citation[];
  /** Context-window usage after this turn; absent if the runtime reported no token stats. */
  context?: ContextUsage;
}

/** Preloads a QVAC chat model and compiled graph once, reusing both across `invoke()` calls; tracks load status for `chat.router.ts`. */
export class AgentService {
  private readonly chatModel: ChatQVAC;
  private readonly chatSession: QvacChatSession;
  private readonly graph: ReturnType<typeof createGraph>;
  private readonly modelInfo: { name: string; quantization: string };
  private readonly sttModel: string;
  private readonly ttsModel: string;
  private status: AgentStatus = "idle";
  private statusError: string | undefined;
  /** In-flight `invoke()` requestIds; lets `cancel()` no-op safely for an unknown/settled id. */
  private readonly pendingRequests = new Set<string>();
  /** Set once `preload()` succeeds, if a delegate is configured. */
  private healthMonitor?: ProviderHealthMonitor;
  /** Caps re-delegation to one attempt per down->up transition; cleared on each observed divergence. */
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
      complete: this.chatSession.complete,
      temperature,
    });
    this.graph = createGraph(this.chatModel, ragService, documentRepository);
  }

  /** Polled by `GET /api/chat/status`. `delegation` is read live, not a `preload()`-time snapshot, so it reflects a mid-session fallback to local. */
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
      // Cancelled isn't a failure: reset to "idle" so a caller can retry, instead of "error".
      if (isCancellationError(err)) {
        this.status = "idle";
      } else {
        this.status = "error";
        this.statusError = err instanceof Error ? err.message : String(err);
      }
      throw err;
    }
  }

  /** Starts heartbeat polling once the chat model loads; no-op without a delegate, idempotent. Ticks skip while a chat is in flight. */
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

  /** Reconciles against the model's live mode, with at most one `switchTo("delegated")` per attempt budget (`redelegationAttempted`). */
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

  /** Re-reads live delegation mode from the SDK; logs if it diverges from the last tracked state (never logs the provider key). */
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

  /** One attempt to switch back to the provider; the log is the only trace of the outcome since a failed attempt isn't retried until the provider recovers again. */
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

  /** Cancels an in-flight `preload()` load; a no-op if nothing is loading. */
  async cancelPreload(): Promise<void> {
    await this.chatSession.cancelLoad();
  }

  /** Streams a reply through the graph; `options` overrides this turn's temperature/seed. Not async: `requestId` is attached synchronously so `cancel()` can target this call before it settles. */
  invoke(
    messages: ConversationMessage[],
    options?: GenerationOptions,
    onToken?: (textDelta: string) => void,
  ): Promise<InvokeResult> & { requestId: string } {
    const requestId = randomUUID();
    this.pendingRequests.add(requestId);

    const result = this.runInvoke(messages, options, requestId, onToken).finally(() => {
      this.pendingRequests.delete(requestId);
    });
    return Object.assign(result, { requestId });
  }

  /** Cancels the in-flight (or queued) completion for `requestId`, without disturbing other concurrent `invoke()` calls; safe no-op for an unknown/settled id. */
  async cancel(requestId: string): Promise<void> {
    if (!this.pendingRequests.has(requestId)) return;
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
    // Safety net: covers a reply that produced no stream event (normal replies already reached onToken above).
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
