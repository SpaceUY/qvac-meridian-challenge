import * as os from "node:os";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import type { RetrievedChunk } from "../../rag/domain/types.js";
import { ChatQVAC } from "./qvacChatModel.js";
import { createGraph } from "./graph.js";
import { loadCorpusContext } from "../context/fullCorpusContext.js";
import type { ModelManagementService } from "../../models/service/models.service.js";
import {
  RESOURCE_THRESHOLDS,
  LOW_RESOURCE_MODEL,
  HIGH_RESOURCE_MODEL,
  type AgentModelConfig,
} from "../../config/models.config.js";

const BYTES_PER_GB = 1024 ** 3;

export type AgentStatus = "idle" | "loading" | "ready" | "error";

export interface AgentStatusPayload {
  status: AgentStatus;
  error?: string;
  model: { name: string; quantization: string };
}

export interface ConversationMessage {
  role: "user" | "assistant";
  message: string;
}

export interface InvokeResult {
  answer: string;
  /** The model's raw reasoning/thinking trace for this reply, when the runtime captured one. */
  thinkingText?: string;
  /** RAG chunks retrieved for this turn and passed to the model as grounding context. */
  chunks: RetrievedChunk[];
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

  constructor(
    service: ModelManagementService,
    ragService: RagRetrievalService,
  ) {
    const { modelSource, modelName, quantization, temperature, ctxSize, engineConfig } =
      this.selectModelConfig();
    this.modelInfo = { name: modelName, quantization };
    this.chatModel = new ChatQVAC({
      service,
      modelSource,
      temperature,
      ctxSize,
      engineConfig,
    });
    this.graph = createGraph(this.chatModel, ragService);
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

  /** The current load status — polled by `GET /api/chat/status` (Task 2). Also carries a model snapshot for the engine panel. */
  getStatus(): AgentStatusPayload {
    return {
      status: this.status,
      ...(this.statusError ? { error: this.statusError } : {}),
      model: this.modelInfo,
    };
  }

  /** Idempotent: a second call while `loading`/`ready` does nothing new. */
  async preload(): Promise<void> {
    if (this.status === "loading" || this.status === "ready") return;
    this.status = "loading";
    this.statusError = undefined;
    try {
      await this.chatModel.ensureModel();
      this.status = "ready";
    } catch (err) {
      this.status = "error";
      this.statusError = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  /** Sends a conversation history through the graph, returns the assistant's reply text and thinking trace. */
  async invoke(messages: ConversationMessage[]): Promise<InvokeResult> {
    //const corpusContext = await this.corpusContext;

    const langchainMessages = messages.map(({ role, message }) =>
      role === "user" ? new HumanMessage(message) : new AIMessage(message),
    );

    const result = await this.graph.invoke({
      // new SystemMessage(
      //   `Reference documents. Use them to answer questions and cite the source path when relevant:\n\n${corpusContext}`,
      // ),
      messages: langchainMessages,
    });

    const lastAIMessage = [...result.messages]
      .reverse()
      .find((message): message is AIMessage => AIMessage.isInstance(message));

    const thinkingText = lastAIMessage?.additional_kwargs.thinkingText;

    return {
      answer: lastAIMessage?.text ?? "",
      thinkingText:
        typeof thinkingText === "string" ? thinkingText : undefined,
      chunks: result.chunks,
    };
  }
}
