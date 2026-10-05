import { Router, type Request, type Response } from "express";
import type { AgentService } from "../ai/orchestrator/agentService.js";
import { EmptyTranscriptError, type VoiceAgentService } from "../ai/orchestrator/voiceAgentService.js";
import type { ReadinessService } from "../health/readinessService.js";
import {
  parseMessages,
  parseHistory,
  parseAudioBase64,
  parseGenerationOptions,
  describeParseError,
  createEnvelope,
  wantsStream,
  toCompletionResponse,
  toRoleChunk,
  toTextChunk,
  toCitationsChunk,
  toContextChunk,
  toToolsChunk,
  toDoneChunk,
  toVoiceAudioChunk,
  toVoiceDoneChunk,
  toVoiceErrorChunk,
  abortOnClientDisconnect,
} from "./chat.router.helpers.js";
import {
  SSE_HEADERS,
  MODEL_NOT_READY_ERROR,
  COMPLETION_ERROR,
  INVALID_AUDIO_ERROR,
  VOICE_COMPLETION_ERROR,
  EMPTY_TRANSCRIPT_ERROR,
  CANCEL_PRELOAD_ERROR,
  INVALID_SESSION_ID_ERROR,
  DELETE_SESSION_CACHE_ERROR,
  SESSION_ID_PATTERN,
} from "./chat.router.const.js";

/** `GET /status` + `POST /preload` + `POST /preload/cancel` + `DELETE /sessions/:sessionId/cache`, mounted at `/api/chat` in server.ts. `readiness` is narrowed to just `check()` so a test can pass a plain fake instead of a real ReadinessService. */
export function createChatStatusRouter(
  agentService: AgentService,
  readiness: Pick<ReadinessService, "check">,
): Router {
  const router = Router();

  router.get("/status", (_req: Request, res: Response) => {
    res.json({ ...agentService.getStatus(), embeddingReady: readiness.check().embeddingReady });
  });

  // Fire-and-forget: the caller polls /status instead of waiting here.
  router.post("/preload", (_req: Request, res: Response) => {
    agentService.preload().catch((err: unknown) => {
      console.error("[chat:preload]", err);
    });
    res.status(202).json(agentService.getStatus());
  });

  // Safe no-op if nothing is loading or the load already finished.
  router.post("/preload/cancel", async (_req: Request, res: Response) => {
    try {
      await agentService.cancelPreload();
      res.json({ ok: true });
    } catch (err) {
      console.error("[chat:preload:cancel]", err);
      res.status(500).json({ error: CANCEL_PRELOAD_ERROR });
    }
  });

  // "New chat": frees the old session's now-unreachable KV cache. No-op if it has none.
  router.delete("/sessions/:sessionId/cache", async (req: Request, res: Response) => {
    const sessionId = String(req.params.sessionId);
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      res.status(400).json({ error: INVALID_SESSION_ID_ERROR });
      return;
    }
    try {
      await agentService.deleteSessionCache(sessionId);
      res.status(204).end();
    } catch (err) {
      console.error("[chat:session-cache:delete]", err);
      res.status(500).json({ error: DELETE_SESSION_CACHE_ERROR });
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
    const messages = await parseMessages(req.body);
    if (!messages) {
      res.status(400).json({ error: await describeParseError(req.body) });
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
        const options = { ...parseGenerationOptions(req.body), sessionId: req.header("X-Meridian-Session") };
        const result = await agent.invoke(messages, options);
        res.json(toCompletionResponse(envelope, result.answer, result.citations, result.toolsUsed));
      } catch (err) {
        console.error("[chat:completions]", err);
        res.status(500).json({ error: COMPLETION_ERROR });
      }
      return;
    }

    res.writeHead(200, SSE_HEADERS);
    // Node buffers headers until the first write() - flush now so the connection is abortable before the first token.
    res.flushHeaders();
    res.write(toRoleChunk(envelope));
    const options = { ...parseGenerationOptions(req.body), sessionId: req.header("X-Meridian-Session") };
    const pending = agent.invoke(messages, options, (textDelta) => {
      res.write(toTextChunk(envelope, textDelta));
    });

    // A client cancels streaming by closing the connection, not a dedicated endpoint.
    // `writableEnded` (only true after this handler's own res.end()) tells a disconnect apart from a normal completion.
    const cancelOnDisconnect = () => {
      if (res.writableEnded) return;
      agent.cancel(pending.requestId).catch((err: unknown) => {
        console.error("[chat:completions:cancel]", err);
      });
    };
    res.on("close", cancelOnDisconnect);

    try {
      const result = await pending;
      res.write(toToolsChunk(envelope, result.toolsUsed));
      // Citations depend on what the model said (see selectCitations) - computed only once the answer is final.
      res.write(toCitationsChunk(envelope, result.citations));
      // Context-budget state (see contextBudget.ts) - the client stops taking new messages once `exhausted`.
      if (result.context) res.write(toContextChunk(envelope, result.context));
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
export type VoiceAgent = Pick<VoiceAgentService, "invoke" | "invokeStreaming">;

/** `POST /voice-completions`, mounted at `/v1/chat`. JSON returns one complete audio buffer; `stream: true` emits audio sentence by sentence. */
export function createVoiceCompletionsRouter(agent: Pick<AgentService, "getStatus">, voiceAgent: VoiceAgent): Router {
  const router = Router();

  router.post("/voice-completions", async (req: Request, res: Response) => {
    const history = await parseHistory(req.body);
    if (!history) {
      res.status(400).json({ error: await describeParseError(req.body) });
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

    // A voice turn runs STT, the LLM and TTS - all of it for nobody once
    // the client hangs up, so the turn is stopped then (see VoiceTurnOptions).
    const disconnect = abortOnClientDisconnect(res);

    if (!wantsStream(req.body)) {
      try {
        const result = await voiceAgent.invoke(history, audio, { signal: disconnect.signal });
        res.json({
          transcript: result.transcript,
          answer: result.answer,
          tools: result.toolsUsed,
          citations: result.citations,
          ...(result.audio ? { audioBase64: result.audio.toString("base64"), sampleRate: result.sampleRate } : {}),
        });
      } catch (err) {
        if (disconnect.signal.aborted) return; // the client is gone: nobody to answer, and stopping isn't a failure
        if (err instanceof EmptyTranscriptError) {
          res.status(400).json({ error: EMPTY_TRANSCRIPT_ERROR });
          return;
        }
        console.error("[chat:voice-completions]", err);
        res.status(500).json({ error: VOICE_COMPLETION_ERROR });
      } finally {
        disconnect.dispose();
      }
      return;
    }

    const envelope = createEnvelope(req.body);
    res.writeHead(200, SSE_HEADERS);
    res.flushHeaders();

    // Headers are already committed here, so failures below surface as a stream error event, not a 400/500.
    try {
      const result = await voiceAgent.invokeStreaming(
        history,
        audio,
        (chunk) => {
          res.write(
            toVoiceAudioChunk(envelope, {
              text: chunk.text,
              ...(chunk.audio ? { audioBase64: chunk.audio.toString("base64"), sampleRate: chunk.sampleRate } : {}),
            }),
          );
        },
        { signal: disconnect.signal },
      );
      res.write(toVoiceDoneChunk(envelope, { transcript: result.transcript, toolsUsed: result.toolsUsed, citations: result.citations, context: result.context }));
    } catch (err) {
      if (disconnect.signal.aborted) return; // the client is gone: no error event to send
      if (err instanceof EmptyTranscriptError) {
        res.write(toVoiceErrorChunk(envelope, EMPTY_TRANSCRIPT_ERROR));
      } else {
        console.error("[chat:voice-completions]", err);
        res.write(toVoiceErrorChunk(envelope, VOICE_COMPLETION_ERROR));
      }
    } finally {
      disconnect.dispose();
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  });

  return router;
}
