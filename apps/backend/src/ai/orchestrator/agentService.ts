import * as os from "node:os";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import type { RagRetrievalService } from "../../rag/service/rag.service.js";
import { ChatQVAC } from "./qvacChatModel.js";
import { createGraph } from "./graph.js";
import { loadCorpusContext } from "../context/fullCorpusContext.js";
import type { ModelManagementService } from "../../models/service/models.service.js";
import {
  RESOURCE_THRESHOLDS,
  LOW_RESOURCE_MODEL,
  HIGH_RESOURCE_MODEL,
  type AgentModelConfig,
} from "../../config/agentService.config.js";

const BYTES_PER_GB = 1024 ** 3;

export interface ConversationMessage {
  role: "user" | "assistant";
  message: string;
}

/**
 * Preloads a QVAC chat model and compiles the stock-assistant graph around
 * it once, so repeated `invoke()` calls reuse both instead of rebuilding
 * them per request.
 */
export class AgentService {
  private readonly chatModel: ChatQVAC;
  private readonly graph: ReturnType<typeof createGraph>;
  //private readonly corpusContext: Promise<string>;

  constructor(
    service: ModelManagementService,
    ragService: RagRetrievalService,
  ) {
    const { modelSource, temperature, ctxSize } = this.selectModelConfig();
    this.chatModel = new ChatQVAC({
      service,
      modelSource,
      temperature,
      ctxSize,
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

  /** Eagerly loads the model, without waiting for the first invoke(). */
  async preload(): Promise<void> {
    await this.chatModel.ensureModel();
  }

  /** Sends a conversation history through the graph, returns the assistant's reply text. */
  async invoke(messages: ConversationMessage[]): Promise<string> {
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

    return lastAIMessage?.text ?? "";
  }
}
