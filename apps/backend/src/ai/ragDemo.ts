import { ChatQVAC } from "@space-uy/qvac-langgraph";
import { QvacChatSession } from "./orchestrator/qvacChatSession.js";
import { createRagGraph } from "./orchestrator/ragGraph.js";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { QWEN3_600M_MODEL_SOURCE } from "../config/models.config.js";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";
import { RagRetrievalService } from "../rag/service/rag.service.js";
import { ResilientEmbeddingService } from "../rag/service/resilientEmbeddingService.js";
import { QvacEmbeddingAdapter } from "../rag/infra/qvacEmbeddingAdapter.js";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL_EXPECTED_SIZE,
  EMBEDDING_MODEL_SOURCE,
} from "../config/models.config.js";
import { buildFixtureVectorStore } from "../rag/infra/fixtures/corpus-chunks.fixture.js";

async function askAndPrint(
  graph: ReturnType<typeof createRagGraph>,
  label: string,
  question: string,
): Promise<void> {
  const result = await graph.invoke({ messages: [new HumanMessage(question)] });
  const answer = [...result.messages]
    .reverse()
    .find((message): message is AIMessage => AIMessage.isInstance(message));
  console.log(`\n${label}`);
  console.log(`  Q: ${question}`);
  console.log(`  A: ${answer?.content}`);
}

async function main(): Promise<void> {
  const adapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(adapter, adapter);

  const chatSession = new QvacChatSession({
    service,
    modelSource: QWEN3_600M_MODEL_SOURCE,
  });
  const qvacModel = new ChatQVAC({
    complete: chatSession.complete,
    temperature: 0,
  });

  const embeddingPort = new ResilientEmbeddingService(
    service,
    new QvacEmbeddingAdapter(),
    EMBEDDING_MODEL_SOURCE,
    DEFAULT_EMBEDDING_BATCH_SIZE,
    EMBEDDING_MODEL_EXPECTED_SIZE,
  );
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(embeddingPort, vectorStore);

  let executionError: unknown;

  try {
    const graph = createRagGraph(qvacModel, ragService);

    await askAndPrint(
      graph,
      "Grounded answer",
      "What is the enterprise P1 first-response SLA?",
    );
    await askAndPrint(
      graph,
      "Insufficient-context answer",
      "What is the weather on Mars?",
    );
  } catch (err) {
    executionError = err;
  }

  try {
    await embeddingPort.unload();
    await service.unloadAll();
    await service.close();
  } catch (cleanupErr) {
    console.error("Cleanup failed:", cleanupErr);
    if (!executionError) {
      throw cleanupErr;
    }
  }

  if (executionError) {
    throw executionError;
  }
}

main().catch((err) => {
  console.error("\n✖ RAG demo failed:", err);
  process.exit(1);
});
