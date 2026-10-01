import * as os from "node:os";
import { randomUUID } from "node:crypto";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import type { Citation, RetrievedChunk } from "../../rag/domain/types.js";
import { selectCitations } from "./citationPolicy.js";
import { ChatQVAC } from "./qvacChatModel.js";
import { createGraph } from "./graph.js";
import { State } from "./domain.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";
import type { ModelManagementService } from "../../models/service/models.service.js";
import type { SupportedImageMimeType } from "../../models/domain/types.js";
import { isCancellationError } from "../../models/domain/errors.js";
import type { LoadedModelDelegationInfo } from "../../models/domain/types.js";
import {
  RESOURCE_THRESHOLDS,
  LOW_RESOURCE_MODEL,
  HIGH_RESOURCE_MODEL,
  type AgentModelConfig,
} from "../../config/models.config.js";
import { DELEGATE_CONFIG } from "../../config/delegate.config.js";

const BYTES_PER_GB = 1024 ** 3;

export type AgentStatus = "idle" | "loading" | "ready" | "error";

export interface AgentStatusPayload {
  status: AgentStatus;
  error?: string;
  model: { name: string; quantization: string };
  /** Present once known (after a successful `preload()`) - whether the chat model is running on a remote provider or locally. Absent while idle/loading/error, or if delegation status couldn't be confirmed. */
  delegation?: LoadedModelDelegationInfo;
}

export interface ConversationMessage {
  role: "user" | "assistant";
  message: string;
  images?: { mimeType: SupportedImageMimeType; data: Buffer }[];
}

function toLangChainMessage({ role, message, images }: ConversationMessage): HumanMessage | AIMessage {
  if (role === "assistant") return new AIMessage(message);
  if (!images?.length) return new HumanMessage(message);

  return new HumanMessage({
    content: [
      { type: "text", text: message },
      ...images.map((image) => ({ type: "image" as const, mimeType: image.mimeType, data: image.data })),
    ],
  });
}

export interface InvokeResult {
  answer: string;
  /** The model's raw reasoning/thinking trace for this reply, when the runtime captured one. */
  thinkingText?: string;
  /** RAG chunks retrieved for this turn and passed to the model as grounding context. */
  chunks: RetrievedChunk[];
  /** Source documents for `answer`, in the evaluator's `{ file, score }` shape. Empty when the answer wasn't grounded - see `selectCitations`. */
  citations: Citation[];
}

/**
 * Preloads a QVAC chat model and compiles the stock-assistant graph around
 * it once, so repeated `invoke()` calls reuse both instead of rebuilding
 * them per request. Also tracks its own load status so an HTTP layer has
 * something real to report (see `chat.router.ts`).
 */
export class AgentService {
  private readonly chatModel: ChatQVAC;
  private readonly graph: ReturnType<typeof createGraph>;
  private readonly modelInfo: { name: string; quantization: string };
  private status: AgentStatus = "idle";
  private statusError: string | undefined;
  //private readonly corpusContext: Promise<string>;
  /** `requestId`s of `invoke()` calls still in flight - lets `cancel()` reject an unknown/already-settled `requestId` as a safe no-op. */
  private readonly pendingRequests = new Set<string>();

  constructor(
    service: ModelManagementService,
    ragService: RagRetrievalService,
    documentRepository: DocumentRepository,
  ) {
    const {
      modelSource,
      modelName,
      quantization,
      temperature,
      ctxSize,
      engineConfig,
    } = this.selectModelConfig();
    this.modelInfo = { name: modelName, quantization };
    this.chatModel = new ChatQVAC({
      service,
      modelSource,
      temperature,
      ctxSize,
      engineConfig,
      delegate: DELEGATE_CONFIG,
    });
    this.graph = createGraph(this.chatModel, ragService, documentRepository);
    //this.corpusContext = loadCorpusContext();
  }

  /**
   * Picks between the configured low- and high-resource models based on
   * this machine's total RAM and CPU core count.
   */
  private selectModelConfig(): AgentModelConfig {
    const ramGB = os.totalmem() / BYTES_PER_GB;
    const cpuCores = os.cpus().length;

    const isLowResource =
      ramGB < RESOURCE_THRESHOLDS.minRamGB ||
      cpuCores < RESOURCE_THRESHOLDS.minCpuCores;

    return isLowResource ? LOW_RESOURCE_MODEL : HIGH_RESOURCE_MODEL;
  }

  /**
   * The current load status — polled by `GET /api/chat/status` (Task 2).
   * Also carries a model snapshot for the engine panel. `delegation` is
   * read live off `chatModel.getCachedDelegationInfo()` rather than a
   * snapshot taken once at `preload()` time, so it reflects a mid-session
   * recovery (the chat model falling back to local after its delegated
   * provider died) instead of staying stuck on stale "still delegated"
   * status forever.
   */
  getStatus(): AgentStatusPayload {
    const delegation = this.chatModel.getCachedDelegationInfo();
    return {
      status: this.status,
      ...(this.statusError ? { error: this.statusError } : {}),
      model: this.modelInfo,
      ...(delegation ? { delegation } : {}),
    };
  }

  /** Idempotent: a second call while `loading`/`ready` does nothing new. */
  async preload(): Promise<void> {
    if (this.status === "loading" || this.status === "ready") return;
    this.status = "loading";
    this.statusError = undefined;
    try {
      await this.chatModel.ensureModel();
      await this.chatModel.getDelegationInfo();
      this.status = "ready";
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
   * Cancels the model load started by `preload()`, if one is currently in
   * flight. Safe to call when nothing is loading - a no-op, same
   * convention as `ModelManagementService.cancel()`.
   */
  async cancelPreload(): Promise<void> {
    await this.chatModel.cancelLoad();
  }

  /**
   * Sends a conversation history through the graph, returns the assistant's
   * reply text and thinking trace. Pass `onToken` to receive the final
   * reply's text as it's generated, rather than only once this resolves.
   *
   * Not `async`: the returned promise carries `requestId` synchronously so
   * a caller can pass it to `cancel()` while the invoke is still running -
   * same convention as `ModelManagementService.loadModel()`/`infer()`.
   */
  invoke(
    messages: ConversationMessage[],
    onToken?: (textDelta: string) => void,
  ): Promise<InvokeResult> & { requestId: string } {
    const requestId = randomUUID();
    this.pendingRequests.add(requestId);

    const result = this.runInvoke(messages, onToken).finally(() => {
      this.pendingRequests.delete(requestId);
    });
    return Object.assign(result, { requestId });
  }

  /**
   * Cancels the chat completion currently in flight for `requestId`, if
   * it's still pending - rejecting the `invoke()` promise it belongs to.
   * Safe to call with an unknown or already-settled `requestId`, same
   * no-op convention as `ModelManagementService.cancel()`.
   *
   * Only one LLM call is ever in flight on `this.chatModel` at a time in
   * practice (`invoke()`'s tool loop awaits each turn before starting the
   * next, and the underlying SDK connection isn't safe for concurrent use -
   * see `ModelManagementService.unloadAll()`), so cancelling "whatever
   * chat call is currently active" is unambiguous as long as `requestId`
   * is still one of `pendingRequests`.
   */
  async cancel(requestId: string): Promise<void> {
    if (!this.pendingRequests.has(requestId)) return;
    await this.chatModel.cancelActive();
  }

  private async runInvoke(
    messages: ConversationMessage[],
    onToken?: (textDelta: string) => void,
  ): Promise<InvokeResult> {
    const langchainMessages = messages.map(toLangChainMessage);

    const stream = await this.graph.stream(
      {
        messages: langchainMessages,
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

    return {
      answer,
      thinkingText: typeof thinkingText === "string" ? thinkingText : undefined,
      chunks,
      citations: selectCitations(answer, chunks),
    };
  }
}
