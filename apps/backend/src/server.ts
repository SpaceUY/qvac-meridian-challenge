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
import { buildFixtureVectorStore } from "./rag/infra/fixtures/corpus-chunks.fixture.js";
import { RagRetrievalService } from "./rag/service/rag.service.js";
import { QvacEmbeddingService } from "./rag/service/qvacEmbeddingService.js";
import type { RagRetrievalConfig } from "./rag/domain/types.js";
import { CorpusDocumentRepository } from "./document/infra/corpusDocumentRepository.js";
import {
  DEFAULT_EMBEDDING_BATCH_SIZE,
  NOMIC_EMBED_TEXT_V1_5_MODEL_SOURCE,
} from "./config/models.config.js";
import { PUBLIC_CHAT_MODEL } from "./chat/chat.router.const.js";

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
let embeddingReady = false;
let embeddingWarmupPromise: Promise<void> | undefined;

function warmUpEmbedding(): Promise<void> {
  if (!embeddingWarmupPromise) {
    embeddingWarmupPromise = embeddingPort
      .embed("readiness warm-up")
      .then(() => {
        embeddingReady = true;
      })
      .catch((err: unknown) => {
        console.error("[server] embedding model warm-up failed", err);
        // Clear so the next call (e.g. the next /health poll, since
        // embeddingReady is still false) starts a fresh attempt instead of
        // being stuck on this rejected promise forever.
        embeddingWarmupPromise = undefined;
        throw err;
      });
  }
  return embeddingWarmupPromise;
}

agentService.preload().catch((err: unknown) => {
  console.error("[server] initial chat model preload failed", err);
});
warmUpEmbedding().catch(() => {
  // Logged inside warmUpEmbedding() already; swallow here so this fire-and-
  // forget kick-off doesn't surface as an unhandled rejection.
});

app.get("/health", (_req, res) => {
  let chatStatus = agentService.getStatus();
  if (chatStatus.status === "error") {
    // preload() sets status to "loading" synchronously before its first
    // await, so re-reading getStatus() right after this call reflects the
    // freshly-kicked attempt instead of the stale "error".
    agentService.preload().catch((err: unknown) => {
      console.error("[server] chat model preload retry failed", err);
    });
    chatStatus = agentService.getStatus();
  }
  if (!embeddingReady) {
    warmUpEmbedding().catch(() => {
      // Logged inside warmUpEmbedding() already.
    });
  }
  if (chatStatus.status === "ready" && embeddingReady) {
    res.status(200).json({ status: "ready" });
    return;
  }
  res.status(503).json({
    status: chatStatus.status,
    embedding: embeddingReady ? "ready" : "loading",
  });
});

app.get("/v1/models", (_req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: PUBLIC_CHAT_MODEL,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "meridian",
      },
    ],
  });
});

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
