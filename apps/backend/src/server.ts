import express from "express";
import cors from "cors";
import { ModelManagementService } from "./models/service/models.service.js";
import { QvacRuntimeAdapter } from "./models/infra/qvacRuntimeAdapter.js";
import { AgentService } from "./ai/orchestrator/agentService.js";
import { createChatStatusRouter, createCompletionsRouter, createVoiceCompletionsRouter } from "./chat/chat.router.js";
import { TtsService } from "./tts/service/tts.service.js";
import { QvacTtsAdapter } from "./tts/infra/qvacTtsAdapter.js";
import { createDocumentsRouter } from "./document/router/documents.router.js";
import { TranscriptionService } from "./speech/service/transcription.service.js";
import { QvacTranscriptionAdapter } from "./speech/infra/qvacTranscriptionAdapter.js";
import { VoiceAgentService } from "./ai/orchestrator/voiceAgentService.js";
import { QvacEmbeddingAdapter } from "./rag/infra/qvacEmbeddingAdapter.js";
import { LanceDbVectorStore } from "./rag/infra/lanceDbVectorStore.js";
import { RagRetrievalService } from "./rag/service/rag.service.js";
import { ResilientEmbeddingService } from "./rag/service/resilientEmbeddingService.js";
import { VECTOR_DB_DIR } from "./config/rag.config.js";
import { CorpusDocumentRepository } from "./document/infra/corpusDocumentRepository.js";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL_EXPECTED_SIZE,
  EMBEDDING_MODEL_SOURCE,
} from "./config/models.config.js";
import { ReadinessService } from "./health/readinessService.js";
import { createHealthRouter, createPublicModelsRouter } from "./health/router/health.router.js";

const app = express();

app.use(cors());
// 25mb: the default 100kb is too small for /v1/chat/voice-completions' base64 audio body.
app.use(express.json({ limit: "25mb" }));

const qvacRuntimeAdapter = new QvacRuntimeAdapter();
const modelManagementService = new ModelManagementService(qvacRuntimeAdapter, qvacRuntimeAdapter);

/** Retrieval over the ingest-built LanceDB table via BGE-M3, sharing `ModelManagementService` with the chat model (one worker, one `close()` owner). The server only reads, never ingests, so a restart never re-embeds. */
if (!(await LanceDbVectorStore.exists(VECTOR_DB_DIR))) {
  throw new Error(`No vector store at ${VECTOR_DB_DIR}. Run "npm run ingest --workspace=apps/backend" first.`);
}
// I.4: native @qvac/embed-llamacpp path primary, @qvac/sdk path as fallback on init failure/crash (see docs/i4-native-addon-results.md).
// EMBEDDING_MODEL_EXPECTED_SIZE lets the native path verify its cached download.
const embeddingPort = new ResilientEmbeddingService(
  modelManagementService,
  new QvacEmbeddingAdapter(),
  EMBEDDING_MODEL_SOURCE,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  EMBEDDING_MODEL_EXPECTED_SIZE,
);
const vectorStore = await LanceDbVectorStore.open(VECTOR_DB_DIR);
// No config override: DEFAULT_RAG_CONFIG.
const ragService = new RagRetrievalService(embeddingPort, vectorStore);

const documentRepository = new CorpusDocumentRepository();
app.use("/api/documents", createDocumentsRouter(documentRepository));
const agentService = new AgentService(
  modelManagementService,
  ragService,
  documentRepository,
);

// Auto-preload so GET /health signals readiness without a separate POST /api/chat/preload - required by qvac-eval.json's "start must not require network access" contract (npm run models:fetch already cache-warmed everything). Chat and embedding warm-up run concurrently, so time-to-ready is max(chat, embedding), not their sum.
// Self-healing across /health polls, not a permanent latch: AgentService.preload() is idempotent and warmUpEmbedding() clears its cached promise on failure so a later call retries.
// Constructed before the chat status router so GET /api/chat/status can merge embeddingReady into one payload.
const readiness = new ReadinessService(agentService, embeddingPort);
readiness.start();
app.use("/api/chat", createChatStatusRouter(agentService, readiness));
app.use("/v1/chat", createCompletionsRouter(agentService));
app.use(createHealthRouter(readiness));
app.use(createPublicModelsRouter(readiness));

const ttsService = new TtsService(modelManagementService, new QvacTtsAdapter());

const transcriptionService = new TranscriptionService(modelManagementService, new QvacTranscriptionAdapter());
const voiceAgentService = new VoiceAgentService(agentService, transcriptionService, ttsService);
app.use("/v1/chat", createVoiceCompletionsRouter(agentService, voiceAgentService));

const server = app.listen(3001, () => {
  console.log("Server listening on port 3001");
});

const SHUTDOWN_CLEANUP_TIMEOUT_MS = 3000;

let shuttingDown = false;

/** Best-effort cleanup with a hard timeout, guarded against re-entry (SIGINT can fire more than once via npm/tsx's wrapper chain). The SDK's worker shares this process's terminal group and may die mid-unload, which could otherwise hang up to the SDK's 30s RPC timeout - no reason to wait that long. */
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  await Promise.race([
    // embeddingPort.unload() first: if the native path is active, asks its bare.exe worker to exit gracefully (see nativeEmbeddingClient.ts) rather than relying solely on its process.once("exit") safety net.
    embeddingPort
      .unload()
      .then(() => modelManagementService.unloadAll())
      .then(() => modelManagementService.close()),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_CLEANUP_TIMEOUT_MS)),
  ]).catch((err: unknown) => {
    console.error("[shutdown] cleanup failed", err);
  });

  server.close(() => process.exit(0));
  // Last resort if server.close() never calls back (e.g. a lingering keep-alive connection).
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
