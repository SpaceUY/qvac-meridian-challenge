import { Router, type Request, type Response } from "express";
import type { AgentService } from "../ai/orchestrator/agentService.js";
import { parseMessages, toTextChunk, toDoneChunk } from "./chat.router.helpers.js";
import { SSE_HEADERS, MODEL_NOT_READY_ERROR, COMPLETION_ERROR, INVALID_MESSAGES_ERROR } from "./chat.router.const.js";

/** `GET /status` + `POST /preload`, mounted at `/api/chat` in server.ts. */
export function createChatStatusRouter(agentService: AgentService): Router {
  const router = Router();

  router.get("/status", (_req: Request, res: Response) => {
    res.json(agentService.getStatus());
  });

  // Fire-and-forget: the caller polls /status for progress instead of
  // waiting here — loading can take a while the first time (download).
  router.post("/preload", (_req: Request, res: Response) => {
    agentService.preload().catch((err: unknown) => {
      console.error("[chat:preload]", err);
    });
    res.status(202).json(agentService.getStatus());
  });

  return router;
}

/** `POST /completions`, mounted at `/v1/chat`. Always SSE, even a single chunk (spec §2). */
export function createCompletionsRouter(agentService: AgentService): Router {
  const router = Router();

  router.post("/completions", async (req: Request, res: Response) => {
    const messages = parseMessages(req.body);
    if (!messages) {
      res.status(400).json({ error: INVALID_MESSAGES_ERROR });
      return;
    }
    if (agentService.getStatus().status !== "ready") {
      res.status(503).json({ error: MODEL_NOT_READY_ERROR });
      return;
    }

    res.writeHead(200, SSE_HEADERS);
    try {
      // NOTE: result.chunks (the RAG citations) aren't wired into the SSE
      // response yet — pending, see the team doc on the citations format.
      const result = await agentService.invoke(messages);
      res.write(toTextChunk(result.answer));
    } catch (err) {
      console.error("[chat:completions]", err);
      res.write(toTextChunk(COMPLETION_ERROR));
    } finally {
      res.write(toDoneChunk());
      res.end();
    }
  });

  return router;
}
