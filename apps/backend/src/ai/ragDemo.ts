import { ChatQVAC } from "./orchestrator/qvacChatModel.js";
import { createRagGraph } from "./orchestrator/ragGraph.js";
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { QWEN3_600M_MODEL_SOURCE } from "../config/models.config.js";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";
import { RagRetrievalService } from "../rag/service/rag.service.js";
import { FakeEmbeddingPort } from "../rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "../rag/infra/fixtures/corpus-chunks.fixture.js";
import type { RagRetrievalConfig } from "../rag/domain/types.js";

/**
 * The FakeEmbeddingPort's raw hashed-bag-of-words cosine scores run lower
 * than a real embedding model's, so this demo overrides `minScore` well
 * below `DEFAULT_RAG_CONFIG`'s 0.65 - tuned for `FakeEmbeddingPort`/the
 * bundled fixtures only, not a value to carry over to a real embedding
 * adapter.
 */
const DEMO_RAG_CONFIG: RagRetrievalConfig = {
  topK: 3,
  minScore: 0.3,
  maxContextChunks: 2,
  dedupeExactContent: true,
};

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

  const qvacModel = new ChatQVAC({
    service,
    modelSource: QWEN3_600M_MODEL_SOURCE,
    temperature: 0,
  });

  const embeddingPort = new FakeEmbeddingPort();
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(embeddingPort, vectorStore, DEMO_RAG_CONFIG);

  let executionError: unknown;

  try {
    const graph = createRagGraph(qvacModel, ragService);

    await askAndPrint(graph, "Grounded answer", "What is the enterprise P1 first-response SLA?");
    await askAndPrint(graph, "Insufficient-context answer", "What is the weather on Mars?");
  } catch (err) {
    executionError = err;
  }

  try {
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
