import { Router } from "express";
import type { ReadinessService } from "../readinessService.js";
import { MODEL_NOT_READY_ERROR, PUBLIC_CHAT_MODEL } from "../../chat/chat.router.const.js";

/** `GET /health` - readiness probe kept for local dev/manual polling; the grading harness itself polls `/v1/models` below. */
export function createHealthRouter(readiness: ReadinessService): Router {
  const router = Router();
  router.get("/health", (_req, res) => {
    const { ready, chatStatus, embeddingReady } = readiness.check();
    if (ready) {
      res.status(200).json({ status: "ready" });
      return;
    }
    res.status(503).json({ status: chatStatus, embedding: embeddingReady ? "ready" : "loading" });
  });
  return router;
}

/** `GET /v1/models` - OpenAI-compatible listing; `qvac-eval.json`'s `readyPath` polls this, so it must not return 200 before the model is actually usable. */
export function createPublicModelsRouter(readiness: ReadinessService): Router {
  const router = Router();
  router.get("/v1/models", (_req, res) => {
    if (!readiness.check().ready) {
      res.status(503).json({ error: MODEL_NOT_READY_ERROR });
      return;
    }
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
  return router;
}
