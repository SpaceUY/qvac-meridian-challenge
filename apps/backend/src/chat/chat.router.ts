import { Router, type Request, type Response } from "express";
import type { AgentService } from "../ai/orchestrator/agentService.js";
import { EmptyTranscriptError, type VoiceAgentService } from "../ai/orchestrator/voiceAgentService.js";
import {
  parseMessages,
  parseHistory,
  parseAudioBase64,
  describeParseError,
  createEnvelope,
  wantsStream,
  toCompletionResponse,
  toRoleChunk,
  toTextChunk,
  toCitationsChunk,
  toDoneChunk,
} from "./chat.router.helpers.js";
import {
  SSE_HEADERS,
  MODEL_NOT_READY_ERROR,
  COMPLETION_ERROR,
  INVALID_AUDIO_ERROR,
  VOICE_COMPLETION_ERROR,
  EMPTY_TRANSCRIPT_ERROR,
  CANCEL_PRELOAD_ERROR,
} from "./chat.router.const.js";

/** `GET /status` + `POST /preload` + `POST /preload/cancel`, mounted at `/api/chat` in server.ts. */
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

  // Cancels the model load started by /preload, if one is in flight. Same
  // safe-no-op convention as the rest of the cancel API: calling this when
  // nothing is loading (or after it already finished) does nothing.
  router.post("/preload/cancel", async (_req: Request, res: Response) => {
    try {
      await agentService.cancelPreload();
      res.json({ ok: true });
    } catch (err) {
      console.error("[chat:preload:cancel]", err);
      res.status(500).json({ error: CANCEL_PRELOAD_ERROR });
    }
  });

  return router;
}

/** What the completions route needs from the orchestrator - narrower than AgentService, so a test can pass a fake. Includes `cancel` (unlike the plan's original cut) because the streaming path below still cancels on client disconnect. */
export type CompletionAgent = Pick<AgentService, "getStatus" | "invoke" | "cancel">;

/** `POST /completions`, mounted at `/v1/chat`. JSON by default (OpenAI's default); SSE only for an explicit `stream: true`. */
export function createCompletionsRouter(agent: CompletionAgent): Router {
  const router = Router();

  router.post("/completions", async (req: Request, res: Response) => {
    const messages = parseMessages(req.body);
    if (!messages) {
      res.status(400).json({ error: describeParseError(req.body) });
      return;
    }
    if (agent.getStatus().status !== "ready") {
      res.status(503).json({ error: MODEL_NOT_READY_ERROR });
      return;
    }

    const envelope = createEnvelope(req.body);

    // The path the QVAC evaluator uses: one JSON object, citations on the message.
    if (!wantsStream(req.body)) {
      try {
        const result = await agent.invoke(messages);
        res.json(toCompletionResponse(envelope, result.answer, result.citations));
      } catch (err) {
        console.error("[chat:completions]", err);
        res.status(500).json({ error: COMPLETION_ERROR });
      }
      return;
    }

    res.writeHead(200, SSE_HEADERS);
    // `writeHead()` alone doesn't put headers on the wire - Node buffers
    // them until the first `write()`. Flush now so the client's connection
    // is actually established (and abortable) before the first token,
    // which may be seconds away.
    res.flushHeaders();
    res.write(toRoleChunk(envelope));
    const pending = agent.invoke(messages, (textDelta) => {
      res.write(toTextChunk(envelope, textDelta));
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
      agent.cancel(pending.requestId).catch((err: unknown) => {
        console.error("[chat:completions:cancel]", err);
      });
    };
    res.on("close", cancelOnDisconnect);

    try {
      const result = await pending;
      // Last, once the answer is final: whether to cite at all depends on
      // what the model said (see selectCitations).
      res.write(toCitationsChunk(envelope, result.citations));
    } catch (err) {
      console.error("[chat:completions]", err);
      if (!res.writableEnded && !res.destroyed) res.write(toTextChunk(envelope, COMPLETION_ERROR));
    } finally {
      res.off("close", cancelOnDisconnect);
      if (!res.writableEnded && !res.destroyed) {
        res.write(toDoneChunk(envelope));
        res.end();
      }
    }
  });

  return router;
}

/** What the voice route needs - narrower than VoiceAgentService, so a test can pass a fake. */
export type VoiceAgent = Pick<VoiceAgentService, "invoke">;

/** `POST /voice-completions`, mounted at `/v1/chat`. One full audio turn in, JSON out — never SSE, the client needs a complete synthesized-audio buffer, not incremental text. */
export function createVoiceCompletionsRouter(agent: Pick<AgentService, "getStatus">, voiceAgent: VoiceAgent): Router {
  const router = Router();

  router.post("/voice-completions", async (req: Request, res: Response) => {
    const history = parseHistory(req.body);
    if (!history) {
      res.status(400).json({ error: describeParseError(req.body) });
      return;
    }
    const audio = parseAudioBase64(req.body);
    if (!audio) {
      res.status(400).json({ error: INVALID_AUDIO_ERROR });
      return;
    }
    if (agent.getStatus().status !== "ready") {
      res.status(503).json({ error: MODEL_NOT_READY_ERROR });
      return;
    }

    try {
      const result = await voiceAgent.invoke(history, audio);
      res.json({
        transcript: result.transcript,
        answer: result.answer,
        citations: result.citations,
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
