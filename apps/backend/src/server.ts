import express from "express";
import cors from "cors";
import { createModelsRouter } from "./models/router/models.router.js";
import { ModelManagementService } from "./models/service/models.service.js";
import { QvacRuntimeAdapter } from "./models/infra/qvacRuntimeAdapter.js";
import { AgentService } from "./ai/orchestrator/agentService.js";
import { createChatStatusRouter, createCompletionsRouter } from "./chat/chat.router.js";
import { createTtsRouter } from "./tts/router/tts.router.js";
import { TtsService } from "./tts/service/tts.service.js";
import { QvacTtsAdapter } from "./tts/infra/qvacTtsAdapter.js";
import { FakeEmbeddingPort } from "./rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "./rag/infra/fixtures/corpus-chunks.fixture.js";
import { RagRetrievalService } from "./rag/service/rag.service.js";
import type { RagRetrievalConfig } from "./rag/domain/types.js";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/ping", (_req, res) => {
  res.json({ message: "pong from express" });
});

const qvacRuntimeAdapter = new QvacRuntimeAdapter();
const modelManagementService = new ModelManagementService(qvacRuntimeAdapter, qvacRuntimeAdapter);
app.use("/api/models", createModelsRouter(modelManagementService));

/**
 * PLACEHOLDER: FakeEmbeddingPort + a handful of fixture chunks "inspired by"
 * corpus/ (not the real files) — same wiring `ai/demo.ts` uses, not yet the
 * persisted, real-corpus vector store [2.3] needs (Lucas's next ticket).
 * minScore is tuned down from `DEFAULT_RAG_CONFIG`'s 0.65 because
 * FakeEmbeddingPort's hashed-bag-of-words cosine scores run lower than a
 * real embedding model's — raise it back once a real adapter is in.
 */
const RAG_CONFIG: RagRetrievalConfig = {
  topK: 3,
  minScore: 0.3,
  maxContextChunks: 2,
  dedupeExactContent: true,
};
const embeddingPort = new FakeEmbeddingPort();
const vectorStore = await buildFixtureVectorStore(embeddingPort);
const ragService = new RagRetrievalService(embeddingPort, vectorStore, RAG_CONFIG);

const agentService = new AgentService(modelManagementService, ragService);
app.use("/api/chat", createChatStatusRouter(agentService));
app.use("/v1/chat", createCompletionsRouter(agentService));

const ttsService = new TtsService(modelManagementService, new QvacTtsAdapter());
app.use("/api/tts", createTtsRouter(ttsService));

const server = app.listen(3001, () => {
  console.log("Server listening on port 3001");
});

async function shutdown(): Promise<void> {
  await modelManagementService.unloadAll();
  await modelManagementService.close();
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
