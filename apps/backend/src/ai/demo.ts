import {
  AgentService,
  type InvokeResult,
} from "./orchestrator/agentService.js";
import { ModelManagementService } from "../models/service/models.service.js";
import { QvacRuntimeAdapter } from "../models/infra/qvacRuntimeAdapter.js";
import { ResilientEmbeddingService } from "../rag/service/resilientEmbeddingService.js";
import { QvacEmbeddingAdapter } from "../rag/infra/qvacEmbeddingAdapter.js";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL_EXPECTED_SIZE,
  EMBEDDING_MODEL_SOURCE,
} from "../config/models.config.js";
import { buildFixtureVectorStore } from "../rag/infra/fixtures/corpus-chunks.fixture.js";
import { RagRetrievalService } from "../rag/service/rag.service.js";
import { CorpusDocumentRepository } from "../document/infra/corpusDocumentRepository.js";

async function main(): Promise<void> {
  const adapter = new QvacRuntimeAdapter();
  const service = new ModelManagementService(adapter, adapter);

  const embeddingPort = new ResilientEmbeddingService(
    service,
    new QvacEmbeddingAdapter(),
    EMBEDDING_MODEL_SOURCE,
    DEFAULT_EMBEDDING_BATCH_SIZE,
    EMBEDDING_MODEL_EXPECTED_SIZE,
  );
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(embeddingPort, vectorStore);

  const documentRepository = new CorpusDocumentRepository();
  const agentService = new AgentService(service, ragService, documentRepository);

  let result: InvokeResult | undefined;
  let executionError: unknown;

  try {
    result = await agentService.invoke([
      {
        role: "user",
        message:
          //"Can you give me all the stock information about SKU: SD-X4-HT?",
          // message: "Do we have an agreement with **Atlas Manufacturing** ? If this is the case when it started ?.",
          "What is the enterprise P1 first-response SLA?",
      },
    ]);
  } catch (err) {
    executionError = err;
  }

  try {
    await embeddingPort.unload();
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

  console.log(result?.answer);
  if (result?.thinkingText) {
    console.log(`\nThinking:\n${result.thinkingText}`);
  }
  if (result?.chunks) {
    console.log(`\nCitations:`);
    console.log(result.chunks);
  }
}

main().catch((err) => {
  console.error("\n✖ Demo failed:", err);
  process.exit(1);
});
