import * as http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import OpenAI from "openai";
import type { AgentService, AgentStatusPayload, ConversationMessage, InvokeResult } from "../ai/orchestrator/agentService.js";
import type { GenerationOptions } from "../ai/orchestrator/domain.js";
import { EmptyTranscriptError } from "../ai/orchestrator/voiceAgentService.js";
import {
  createChatStatusRouter,
  createCompletionsRouter,
  createVoiceCompletionsRouter,
  type CompletionAgent,
  type VoiceAgent,
} from "./chat.router.js";
import { EMPTY_TRANSCRIPT_ERROR } from "./chat.router.const.js";

/**
 * Stands in for `AgentService` for router-level tests: `invoke()` never
 * settles on its own - only `cancel()` rejects it - so a test can hold a
 * request open long enough to abort it client-side and observe the
 * server's reaction, without a real model/graph.
 */
const FAKE_INVOKE_RESULT: InvokeResult = { answer: "ok", chunks: [], toolsUsed: [], citations: [] };

class FakeAgentService {
  readonly cancelledRequestIds: string[] = [];
  private rejectActive?: (err: unknown) => void;
  private activeRequestId?: string;
  private nextRequestId = 0;
  /** When set, `invoke()` resolves with this instead of staying pending until cancelled. */
  resolveWith?: InvokeResult;

  getStatus(): AgentStatusPayload {
    return {
      status: "ready",
      model: { name: "fake", quantization: "q4" },
      hardwareTier: "low",
      recovering: false,
      sttModel: "fake-stt",
      ttsModel: "fake-tts",
    };
  }

  invoke(
    _messages: ConversationMessage[],
    _options?: GenerationOptions,
    onToken?: (textDelta: string) => void,
  ): Promise<InvokeResult> & { requestId: string } {
    const requestId = `req-${(this.nextRequestId += 1)}`;
    this.activeRequestId = requestId;
    const promise =
      this.resolveWith !== undefined
        ? Promise.resolve().then(() => {
            onToken?.(this.resolveWith!.answer);
            return this.resolveWith!;
          })
        : new Promise<InvokeResult>((_resolve, reject) => {
            this.rejectActive = reject;
          });
    return Object.assign(promise, { requestId });
  }

  async cancel(requestId: string): Promise<void> {
    if (requestId !== this.activeRequestId) return;
    this.cancelledRequestIds.push(requestId);
    this.rejectActive?.(new Error("cancelled"));
  }

  readonly deletedSessionIds: string[] = [];
  deleteSessionCacheShouldFail = false;

  async deleteSessionCache(sessionId: string): Promise<void> {
    if (this.deleteSessionCacheShouldFail) throw new Error("boom");
    this.deletedSessionIds.push(sessionId);
  }

  cancelPreloadCallCount = 0;
  cancelPreloadShouldFail = false;

  async cancelPreload(): Promise<void> {
    this.cancelPreloadCallCount += 1;
    if (this.cancelPreloadShouldFail) throw new Error("boom");
  }
}

describe("POST /completions - client disconnect", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("cancels the in-flight invoke when the client aborts the request mid-stream, per the OpenAI convention of cancelling via connection close", async () => {
    const fakeAgentService = new FakeAgentService();
    const app = express();
    app.use(express.json());
    app.use("/v1/chat", createCompletionsRouter(fakeAgentService as unknown as AgentService));

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], stream: true }),
      signal: controller.signal,
    });
    expect(response.status).toBe(200);

    controller.abort();

    await expect
      .poll(() => fakeAgentService.cancelledRequestIds, { timeout: 2000 })
      .toEqual(["req-1"]);
  });

  it("never calls cancel() for a request that completes normally", async () => {
    const fakeAgentService = new FakeAgentService();
    fakeAgentService.resolveWith = FAKE_INVOKE_RESULT;
    const app = express();
    app.use(express.json());
    app.use("/v1/chat", createCompletionsRouter(fakeAgentService as unknown as AgentService));

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], stream: true }),
    });
    const body = await response.text();

    expect(body).toContain("[DONE]");
    expect(fakeAgentService.cancelledRequestIds).toEqual([]);
  });
});

/** Always-ready readiness fake, reused by every `createChatStatusRouter()` call site in this file that isn't testing readiness itself. */
const fakeReadiness = { check: () => ({ ready: true, chatStatus: "ready" as const, embeddingReady: true }) };

describe("GET /status", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("merges embeddingReady from the readiness source into the agent's own status", async () => {
    const fakeAgentService = new FakeAgentService();
    const readiness = { check: () => ({ ready: true, chatStatus: "ready" as const, embeddingReady: true }) };
    const app = express();
    app.use("/api/chat", createChatStatusRouter(fakeAgentService as unknown as AgentService, readiness));

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/status`);
    const body = (await response.json()) as { status: string; embeddingReady: boolean };

    expect(body.status).toBe("ready");
    expect(body.embeddingReady).toBe(true);
  });

  it("reports embeddingReady: false while the embedding model is still warming up", async () => {
    const fakeAgentService = new FakeAgentService();
    const readiness = { check: () => ({ ready: false, chatStatus: "ready" as const, embeddingReady: false }) };
    const app = express();
    app.use("/api/chat", createChatStatusRouter(fakeAgentService as unknown as AgentService, readiness));

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/status`);
    const body = (await response.json()) as { embeddingReady: boolean };

    expect(body.embeddingReady).toBe(false);
  });
});

describe("POST /preload/cancel", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it("cancels the model load in progress", async () => {
    const fakeAgentService = new FakeAgentService();
    const app = express();
    app.use("/api/chat", createChatStatusRouter(fakeAgentService as unknown as AgentService, fakeReadiness));

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/preload/cancel`, { method: "POST" });

    expect(response.status).toBe(200);
    expect(fakeAgentService.cancelPreloadCallCount).toBe(1);
  });

  it("responds 500 when cancelling the load fails", async () => {
    const fakeAgentService = new FakeAgentService();
    fakeAgentService.cancelPreloadShouldFail = true;
    const app = express();
    app.use("/api/chat", createChatStatusRouter(fakeAgentService as unknown as AgentService, fakeReadiness));

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/preload/cancel`, { method: "POST" });

    expect(response.status).toBe(500);
  });
});

describe("DELETE /sessions/:sessionId/cache", () => {
  const SESSION_ID = "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b";
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function startServer(fakeAgentService: FakeAgentService): Promise<number> {
    const app = express();
    app.use("/api/chat", createChatStatusRouter(fakeAgentService as unknown as AgentService, fakeReadiness));
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    return (server.address() as AddressInfo).port;
  }

  it("deletes the KV cache of the session and responds 204", async () => {
    const fakeAgentService = new FakeAgentService();
    const port = await startServer(fakeAgentService);

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/sessions/${SESSION_ID}/cache`, { method: "DELETE" });

    expect(response.status).toBe(204);
    expect(fakeAgentService.deletedSessionIds).toEqual([SESSION_ID]);
  });

  it("responds 400 and deletes nothing when the session id is not a UUID", async () => {
    const fakeAgentService = new FakeAgentService();
    const port = await startServer(fakeAgentService);

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/sessions/..%2F..%2Fother/cache`, { method: "DELETE" });

    expect(response.status).toBe(400);
    expect(fakeAgentService.deletedSessionIds).toEqual([]);
  });

  it("responds 500 without leaking the internal error when the delete fails", async () => {
    const fakeAgentService = new FakeAgentService();
    fakeAgentService.deleteSessionCacheShouldFail = true;
    const port = await startServer(fakeAgentService);

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/sessions/${SESSION_ID}/cache`, { method: "DELETE" });

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("boom");
  });
});

const ANSWER = "Q2 2026 total revenue was $18.4M.";
const CITATIONS = [{ file: "reports/q2-2026-sales-performance-report.md", score: 0.83 }];
const QUESTION = [{ role: "user" as const, content: "What was Q2 2026 revenue?" }];

/** Orchestrator stand-in: streams the answer in two deltas, like the real one streams tokens. */
const fakeAgent: CompletionAgent = {
  getStatus: () => ({ status: "ready", model: { name: "fake", quantization: "none" }, hardwareTier: "low", recovering: false, sttModel: "fake-stt", ttsModel: "fake-tts" }),
  invoke: (_messages, _options, onToken) => {
    const promise = (async () => {
      onToken?.("Q2 2026 total revenue ");
      onToken?.("was $18.4M.");
      return { answer: ANSWER, chunks: [], toolsUsed: [], citations: CITATIONS };
    })();
    return Object.assign(promise, { requestId: "req-fake" });
  },
  cancel: async () => {},
};

const fakeVoiceAgent: VoiceAgent = {
  invoke: async () => ({ transcript: "What was Q2 revenue?", answer: ANSWER, chunks: [], toolsUsed: [], citations: CITATIONS }),
  invokeStreaming: async (_history, _audio, onChunk) => {
    await onChunk({ text: ANSWER });
    return { transcript: "What was Q2 revenue?", answer: ANSWER, chunks: [], toolsUsed: [], citations: CITATIONS };
  },
};

/** `citations` is our extension to the OpenAI shape, so the SDK's types don't declare it. */
function citationsOf(value: object): unknown {
  return (value as { citations?: unknown }).citations;
}

// Shared by both describes below: one server, one stock OpenAI client, pointed at both routes.
let contractServer: http.Server;
let client: OpenAI;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/v1/chat", createCompletionsRouter(fakeAgent));
  app.use("/v1/chat", createVoiceCompletionsRouter(fakeAgent, fakeVoiceAgent));
  contractServer = await new Promise<http.Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = contractServer.address() as AddressInfo;
  // A stock OpenAI client - the same kind the QVAC evaluator points at the API.
  client = new OpenAI({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "not-needed" });
});

afterAll(() => new Promise<void>((resolve) => contractServer.close(() => resolve())));

describe("POST /v1/chat/completions - contract with the stock OpenAI SDK", () => {
  it("stream omitted: a chat.completion with message.citations", async () => {
    const completion = await client.chat.completions.create({ model: "meridian-assistant", messages: QUESTION });

    expect(completion.object).toBe("chat.completion");
    expect(completion.id).toMatch(/^chatcmpl-/);
    expect(completion.model).toBe("meridian-assistant");
    expect(completion.choices[0].finish_reason).toBe("stop");
    expect(completion.choices[0].message.content).toBe(ANSWER);
    expect(citationsOf(completion.choices[0].message)).toEqual(CITATIONS);
  });

  it("stream: true: text as deltas, one id throughout, citations in the last content chunk", async () => {
    const stream = await client.chat.completions.create({ model: "meridian-assistant", messages: QUESTION, stream: true });

    const ids = new Set<string>();
    let text = "";
    let citations: unknown;
    for await (const chunk of stream) {
      ids.add(chunk.id);
      expect(chunk.object).toBe("chat.completion.chunk");
      text += chunk.choices[0].delta.content ?? "";
      citations = citationsOf(chunk.choices[0].delta) ?? citations;
    }

    expect(ids.size).toBe(1);
    expect(text).toBe(ANSWER);
    expect(citations).toEqual(CITATIONS);
  });

  it("stream helper: the accumulated final message keeps citations", async () => {
    const runner = client.chat.completions.stream({ model: "meridian-assistant", messages: QUESTION });
    const final = await runner.finalChatCompletion();
    expect(citationsOf(final.choices[0].message)).toEqual(CITATIONS);
  });
});

describe("POST /v1/chat/completions - tools", () => {
  it("carries which tools the agent used on the final message, when the fake agent reports one", async () => {
    const toolAgent: CompletionAgent = {
      ...fakeAgent,
      invoke: (_messages, _options, onToken) => {
        const promise = (async () => {
          onToken?.(ANSWER);
          return { answer: ANSWER, chunks: [], toolsUsed: ["lookup_stock"], citations: CITATIONS };
        })();
        return Object.assign(promise, { requestId: "req-tools" });
      },
    };
    const app = express();
    app.use(express.json());
    app.use("/v1/chat", createCompletionsRouter(toolAgent));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: QUESTION, stream: false }),
    });
    const body = (await res.json()) as { choices: [{ message: { tools?: unknown } }] };

    expect(body.choices[0].message.tools).toEqual(["lookup_stock"]);
    server.close();
  });
});

describe("POST /v1/chat/voice-completions", () => {
  it("returns the same citations array as the text endpoint", async () => {
    const res = await fetch(`${client.baseURL}/chat/voice-completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [], audioBase64: Buffer.from("fake-wav").toString("base64") }),
    });

    expect(res.status).toBe(200);
    // Node's fetch types `json()` as `Promise<unknown>`: narrow before reading a field, or `tsc` fails.
    const body = (await res.json()) as { citations?: unknown };
    expect(body.citations).toEqual(CITATIONS);
  });

  it("carries which tools the agent used, when the voice agent reports one", async () => {
    const toolVoiceAgent: VoiceAgent = {
      invoke: async () => ({
        transcript: "How many SD-X4-001 in stock?",
        answer: ANSWER,
        chunks: [],
        toolsUsed: ["lookup_stock"],
        citations: CITATIONS,
      }),
      invokeStreaming: fakeVoiceAgent.invokeStreaming,
    };
    const app = express();
    app.use(express.json());
    app.use("/v1/chat", createVoiceCompletionsRouter(fakeAgent, toolVoiceAgent));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/v1/chat/voice-completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [], audioBase64: Buffer.from("fake-wav").toString("base64") }),
    });
    const body = (await res.json()) as { tools?: unknown };

    expect(body.tools).toEqual(["lookup_stock"]);
    server.close();
  });
});

describe("POST /v1/chat/voice-completions - stream: true", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  /** Extracts each SSE event's JSON payload, in order, excluding the `[DONE]` terminator. */
  function parseSseEvents(body: string): Record<string, unknown>[] {
    return body
      .split("\n\n")
      .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
      .map((event) => JSON.parse(event.slice("data: ".length)) as Record<string, unknown>);
  }

  async function startServer(voiceAgent: VoiceAgent): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use("/v1/chat", createVoiceCompletionsRouter(fakeAgent, voiceAgent));
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/v1/chat/voice-completions`;
  }

  it("emits one SSE event per synthesized sentence, then a final event with transcript and citations", async () => {
    const url = await startServer({
      invoke: fakeVoiceAgent.invoke,
      invokeStreaming: async (_history, _audio, onChunk) => {
        await onChunk({ text: "Q2 2026 total revenue ", audio: Buffer.from("chunk1"), sampleRate: 24000 });
        await onChunk({ text: "was $18.4M." });
        return { transcript: "What was Q2 revenue?", answer: ANSWER, chunks: [], toolsUsed: [], citations: CITATIONS };
      },
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [],
        audioBase64: Buffer.from("fake-wav").toString("base64"),
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("data: [DONE]");

    const events = parseSseEvents(body);
    expect(events[0]).toMatchObject({ type: "audio", text: "Q2 2026 total revenue " });
    expect(events[0].audioBase64).toBe(Buffer.from("chunk1").toString("base64"));
    expect(events[0].sampleRate).toBe(24000);
    expect(events[1]).toMatchObject({ type: "audio", text: "was $18.4M." });
    expect(events[1].audioBase64).toBeUndefined();
    expect(events[2]).toMatchObject({
      type: "done",
      transcript: "What was Q2 revenue?",
      tools: [],
      citations: CITATIONS,
    });
  });

  it("emits an SSE error event instead of a JSON 400 when transcription yields no text", async () => {
    const url = await startServer({
      invoke: fakeVoiceAgent.invoke,
      invokeStreaming: async () => {
        throw new EmptyTranscriptError();
      },
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [],
        audioBase64: Buffer.from("fake-wav").toString("base64"),
        stream: true,
      }),
    });

    // Headers are already committed to text/event-stream by the time the
    // empty-transcript case is known, so this can't become a 400 - the
    // error surfaces as a stream event instead (same as any other
    // generation error).
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("data: [DONE]");
    expect(parseSseEvents(body)[0]).toMatchObject({ type: "error", error: EMPTY_TRANSCRIPT_ERROR });
  });
});

describe("POST /v1/chat/completions - context usage", () => {
  async function streamBody(result: InvokeResult): Promise<string> {
    const agent = new FakeAgentService();
    agent.resolveWith = result;
    const app = express();
    app.use(express.json());
    app.use("/v1/chat", createCompletionsRouter(agent as unknown as AgentService));
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }], stream: true }),
      });
      return await res.text();
    } finally {
      server.close();
    }
  }

  it("sends the context usage after the citations and before [DONE]", async () => {
    const context = { usedTokens: 13200, maxTokens: 16384, exhausted: true };
    const body = await streamBody({ ...FAKE_INVOKE_RESULT, context });

    const contextAt = body.indexOf(JSON.stringify({ context }));
    expect(contextAt).toBeGreaterThan(body.indexOf('"citations"'));
    expect(body.indexOf("[DONE]")).toBeGreaterThan(contextAt);
  });

  it("sends no context chunk when the agent measured nothing", async () => {
    expect(await streamBody(FAKE_INVOKE_RESULT)).not.toContain('"context"');
  });
});
