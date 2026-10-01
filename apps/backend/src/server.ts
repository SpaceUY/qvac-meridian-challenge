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
  EMBEDDING_MODEL_SOURCE,
} from "./config/models.config.js";
import { ReadinessService } from "./health/readinessService.js";
import { createHealthRouter, createPublicModelsRouter } from "./health/router/health.router.js";

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
 * Retrieval over the persisted LanceDB table written by `npm run ingest`,
 * queried with EmbeddingGemma through the same `ModelManagementService` as
 * the chat model: one QVAC worker, one owner of `close()`, and `unloadAll()`
 * on shutdown releases both models. The server only READS the table - it
 * never ingests - so a restart never re-embeds the corpus.
 */
if (!(await LanceDbVectorStore.exists(VECTOR_DB_DIR))) {
  throw new Error(`No vector store at ${VECTOR_DB_DIR}. Run "npm run ingest --workspace=apps/backend" first.`);
}
// I.4: native @qvac/embed-llamacpp path primary, @qvac/sdk path as fallback
// (init failure or a mid-session worker crash) - see
// docs/i4-native-addon-results.md. Same constructor shape as the
// QvacEmbeddingService it replaces.
const embeddingPort = new ResilientEmbeddingService(
  modelManagementService,
  new QvacEmbeddingAdapter(),
  EMBEDDING_MODEL_SOURCE,
  DEFAULT_EMBEDDING_BATCH_SIZE,
);
const vectorStore = await LanceDbVectorStore.open(VECTOR_DB_DIR);
// No config override: DEFAULT_RAG_CONFIG, the same tuning as ragDemo.
const ragService = new RagRetrievalService(embeddingPort, vectorStore);

const documentRepository = new CorpusDocumentRepository();
app.use("/api/documents", createDocumentsRouter(documentRepository));
const agentService = new AgentService(
  modelManagementService,
  ragService,
  documentRepository,
);
app.use("/api/chat", createChatStatusRouter(agentService));
app.use("/v1/chat", createCompletionsRouter(agentService));

// Auto-preload so `GET /health` can signal readiness without a separate
// POST /api/chat/preload call - required for qvac-eval.json's "start must
// not require network access" contract: by the time this runs, `npm run
// models:fetch` has already cache-warmed every asset this touches. Chat and
// embedding warm-up run CONCURRENTLY (both fire-and-forget, neither awaited
// before the other starts) so total time-to-ready is max(chat load,
// embedding load), not their sum.
//
// Both warm-ups are self-healing across `/health` polls rather than
// permanently latching on one transient failure (this branch loads chat +
// embedding concurrently into the same worker process, which is exactly the
// situation most likely to produce a one-off hiccup): `AgentService.preload()`
// is idempotent and safe to call again once its status is "error" - it only
// no-ops while "loading"/"ready" (see its own doc comment) - and
// `warmUpEmbedding()` below mirrors `QvacEmbeddingService.ensureModel()`'s own
// cached-promise-cleared-on-failure pattern so a later call actually retries
// instead of reusing a rejected promise forever.
const readiness = new ReadinessService(agentService, embeddingPort);
readiness.start();
app.use(createHealthRouter(readiness));
app.use(createPublicModelsRouter(readiness));

const ttsService = new TtsService(modelManagementService, new QvacTtsAdapter());
app.use("/api/tts", createTtsRouter(ttsService));

const transcriptionService = new TranscriptionService(modelManagementService, new QvacTranscriptionAdapter());
const voiceAgentService = new VoiceAgentService(agentService, transcriptionService, ttsService);
app.use("/v1/chat", createVoiceCompletionsRouter(agentService, voiceAgentService));

const server = app.listen(3001, () => {
  console.log("Server listening on port 3001");
});

const SHUTDOWN_CLEANUP_TIMEOUT_MS = 3000;

let shuttingDown = false;

/**
 * Best-effort cleanup with a hard timeout, guarded against re-entry (SIGINT
 * can be delivered/forwarded more than once, e.g. by npm/tsx's own wrapper
 * chain). On a real Ctrl+C, @qvac/sdk's spawned worker process shares this
 * process's terminal process group and receives the same SIGINT, so it can
 * die concurrently with (or before) unloadAll()/close() try to talk to it -
 * either call can then hang for as long as the SDK's own internal RPC
 * timeout (30s). The worker is going down either way, so there's no reason
 * to wait that long here.
 */
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  await Promise.race([
    // embeddingPort.unload() first: if the native path is active, this asks
    // its bare.exe worker to unload and exit gracefully (see
    // nativeEmbeddingClient.ts) instead of relying solely on the
    // process.once("exit") kill-if-still-alive safety net that class also
    // registers.
    embeddingPort
      .unload()
      .then(() => modelManagementService.unloadAll())
      .then(() => modelManagementService.close()),
    new Promise((resolve) => setTimeout(resolve, SHUTDOWN_CLEANUP_TIMEOUT_MS)),
  ]).catch((err: unknown) => {
    console.error("[shutdown] cleanup failed", err);
  });

  server.close(() => process.exit(0));
  // Last resort in case server.close() never calls back (e.g. a lingering
  // keep-alive connection).
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
