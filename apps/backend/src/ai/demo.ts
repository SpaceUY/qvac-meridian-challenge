import { AgentService } from "./orchestrator/agentService.js";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";
import { FakeEmbeddingPort } from "../rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "../rag/infra/fixtures/corpus-chunks.fixture.js";
import { RagRetrievalService } from "../rag/service/rag.service.js";
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

async function main(): Promise<void> {
  const adapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(adapter, adapter);

  const embeddingPort = new FakeEmbeddingPort();
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(
    embeddingPort,
    vectorStore,
    DEMO_RAG_CONFIG,
  );

  const agentService = new AgentService(service, ragService);

  let result: string | undefined;
  let executionError: unknown;

  try {
    result = await agentService.invoke([
      {
        role: "user",
        message:
          "Can you give me all the stock information about SKU: SD-X4-HT?",
        // message: "Do we have an agreement with **Atlas Manufacturing** ? If this is the case when it started ?.",
        // message: "What is the enterprise P1 first-response SLA?",
      },
    ]);
  } catch (err) {
    executionError = err;
  }

  try {
    await service.unloadAll();
    await service.close();
  } catch (cleanupErr) {
    console.error("Cleanup failed:", cleanupErr);
    // Only surface the cleanup failure if there's no earlier, more relevant error.
    if (!executionError) {
      throw cleanupErr;
    }
  }

  if (executionError) {
    throw executionError;
  }

  console.log(result);
}

main().catch((err) => {
  console.error("\n✖ Demo failed:", err);
  process.exit(1);
});
