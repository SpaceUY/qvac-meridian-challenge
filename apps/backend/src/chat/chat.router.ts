import { Router, type Request, type Response } from "express";
import type { AgentService } from "../ai/orchestrator/agentService.js";
import { EmptyTranscriptError, type VoiceAgentService } from "../ai/orchestrator/voiceAgentService.js";
import { parseMessages, parseHistory, parseAudioBase64, toTextChunk, toDoneChunk } from "./chat.router.helpers.js";
import {
  SSE_HEADERS,
  MODEL_NOT_READY_ERROR,
  COMPLETION_ERROR,
  INVALID_MESSAGES_ERROR,
  INVALID_AUDIO_ERROR,
  VOICE_COMPLETION_ERROR,
  EMPTY_TRANSCRIPT_ERROR,
} from "./chat.router.const.js";

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
    // `writeHead()` alone doesn't put headers on the wire - Node buffers
    // them until the first `write()`. Flush now so the client's connection
    // is actually established (and abortable) before the first token,
    // which may be seconds away.
    res.flushHeaders();
    // NOTE: chunks (the RAG citations) aren't wired into the SSE response
    // yet — pending, see the team doc on the citations format.
    const pending = agentService.invoke(messages, (textDelta) => {
      res.write(toTextChunk(textDelta));
    });

    // OpenAI's API has no dedicated cancel endpoint for chat completions -
    // a client cancels a streaming request by closing the connection, and
    // the server is expected to stop generating rather than keep running
    // for a response nobody reads. `res`'s `close` event fires both on a
    // normal completion and on the client hanging up early; `writableEnded`
    // tells them apart (it's only true once this handler's own `res.end()`
    // below has run), so a normal completion never calls cancel() on its
    // own already-settled requestId.
    const cancelOnDisconnect = () => {
      if (res.writableEnded) return;
      agentService.cancel(pending.requestId).catch((err: unknown) => {
        console.error("[chat:completions:cancel]", err);
      });
    };
    res.on("close", cancelOnDisconnect);

    try {
      await pending;
    } catch (err) {
      console.error("[chat:completions]", err);
      if (!res.writableEnded && !res.destroyed) res.write(toTextChunk(COMPLETION_ERROR));
    } finally {
      res.off("close", cancelOnDisconnect);
      if (!res.writableEnded && !res.destroyed) {
        res.write(toDoneChunk());
        res.end();
      }
    }
  });

  return router;
}

/** `POST /voice-completions`, mounted at `/v1/chat`. One full audio turn in, JSON out — never SSE, the client needs a complete synthesized-audio buffer, not incremental text. */
export function createVoiceCompletionsRouter(agentService: AgentService, voiceAgentService: VoiceAgentService): Router {
  const router = Router();

  router.post("/voice-completions", async (req: Request, res: Response) => {
    const history = parseHistory(req.body);
    if (!history) {
      res.status(400).json({ error: INVALID_MESSAGES_ERROR });
      return;
    }
    const audio = parseAudioBase64(req.body);
    if (!audio) {
      res.status(400).json({ error: INVALID_AUDIO_ERROR });
      return;
    }
    if (agentService.getStatus().status !== "ready") {
      res.status(503).json({ error: MODEL_NOT_READY_ERROR });
      return;
    }

    try {
      const result = await voiceAgentService.invoke(history, audio);
      res.json({
        transcript: result.transcript,
        answer: result.answer,
        ...(result.audio ? { audioBase64: result.audio.toString("base64"), sampleRate: result.sampleRate } : {}),
      });
    } catch (err) {
      if (err instanceof EmptyTranscriptError) {
        res.status(400).json({ error: EMPTY_TRANSCRIPT_ERROR });
        return;
      }
      console.error("[chat:voice-completions]", err);
      res.status(500).json({ error: VOICE_COMPLETION_ERROR });
    }
  });

  return router;
}
