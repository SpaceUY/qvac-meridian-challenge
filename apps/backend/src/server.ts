import express from "express";
import cors from "cors";
import { createModelsRouter } from "./models/router/models.router.js";
import { ModelManagementService } from "./models/service/models.service.js";
import { QvacRuntimeAdapter } from "./models/infra/qvacRuntimeAdapter.js";
import { AgentService } from "./ai/orchestrator/agentService.js";
import { createChatStatusRouter, createCompletionsRouter, createVoiceCompletionsRouter } from "./chat/chat.router.js";
import { createTtsRouter } from "./tts/router/tts.router.js";
import { TtsService } from "./tts/service/tts.service.js";
import { QvacTtsAdapter } from "./tts/infra/qvacTtsAdapter.js";
import { TranscriptionService } from "./speech/service/transcription.service.js";
import { QvacTranscriptionAdapter } from "./speech/infra/qvacTranscriptionAdapter.js";
import { VoiceAgentService } from "./ai/orchestrator/voiceAgentService.js";
import { QvacEmbeddingAdapter } from "./rag/infra/qvacEmbeddingAdapter.js";
import { buildFixtureVectorStore } from "./rag/infra/fixtures/corpus-chunks.fixture.js";
import { RagRetrievalService } from "./rag/service/rag.service.js";
import { QvacEmbeddingService } from "./rag/service/qvacEmbeddingService.js";
import type { RagRetrievalConfig } from "./rag/domain/types.js";
import { CorpusDocumentRepository } from "./document/infra/corpusDocumentRepository.js";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  NOMIC_EMBED_TEXT_V1_5_MODEL_SOURCE,
} from "./config/models.config.js";

const app = express();

app.use(cors());
// Default 100kb is too small for /v1/chat/voice-completions' base64 audio
// body - a few seconds of audio already exceeds it.
app.use(express.json({ limit: "25mb" }));

app.get("/api/ping", (_req, res) => {
  res.json({ message: "pong from express" });
});

const qvacRuntimeAdapter = new QvacRuntimeAdapter();
const modelManagementService = new ModelManagementService(qvacRuntimeAdapter, qvacRuntimeAdapter);
app.use("/api/models", createModelsRouter(modelManagementService));

/**
 * PLACEHOLDER: real embeddings (nomic-embed-text-v1.5 via QVAC) over a
 * handful of fixture chunks "inspired by" corpus/ (not the real files) —
 * not yet the persisted, real-corpus vector store [2.3] needs (Lucas's next
 * ticket). minScore is still tuned down from `DEFAULT_RAG_CONFIG`'s 0.65;
 * re-tune once retrieval has been exercised against the real model at
 * runtime (no local inference happens in this environment to calibrate it
 * against).
 */
const RAG_CONFIG: RagRetrievalConfig = {
  topK: 3,
  minScore: 0.3,
  maxContextChunks: 2,
  dedupeExactContent: true,
};
const embeddingPort = new QvacEmbeddingService(
  modelManagementService,
  new QvacEmbeddingAdapter(),
  NOMIC_EMBED_TEXT_V1_5_MODEL_SOURCE,
  DEFAULT_EMBEDDING_BATCH_SIZE,
);
const vectorStore = await buildFixtureVectorStore(embeddingPort);
const ragService = new RagRetrievalService(embeddingPort, vectorStore, RAG_CONFIG);

const documentRepository = new CorpusDocumentRepository();
const agentService = new AgentService(
  modelManagementService,
  ragService,
  documentRepository,
);
app.use("/api/chat", createChatStatusRouter(agentService));
app.use("/v1/chat", createCompletionsRouter(agentService));

const ttsService = new TtsService(modelManagementService, new QvacTtsAdapter());
app.use("/api/tts", createTtsRouter(ttsService));

const transcriptionService = new TranscriptionService(modelManagementService, new QvacTranscriptionAdapter());
const voiceAgentService = new VoiceAgentService(agentService, transcriptionService, ttsService);
app.use("/v1/chat", createVoiceCompletionsRouter(agentService, voiceAgentService));

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
