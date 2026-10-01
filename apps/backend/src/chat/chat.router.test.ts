import * as http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentService, AgentStatusPayload, ConversationMessage, InvokeResult } from "../ai/orchestrator/agentService.js";
import { createChatStatusRouter, createCompletionsRouter } from "./chat.router.js";

/**
 * Stands in for `AgentService` for router-level tests: `invoke()` never
 * settles on its own - only `cancel()` rejects it - so a test can hold a
 * request open long enough to abort it client-side and observe the
 * server's reaction, without a real model/graph.
 */
const FAKE_INVOKE_RESULT: InvokeResult = { answer: "ok", chunks: [] };

class FakeAgentService {
  readonly cancelledRequestIds: string[] = [];
  private rejectActive?: (err: unknown) => void;
  private activeRequestId?: string;
  private nextRequestId = 0;
  /** When set, `invoke()` resolves with this instead of staying pending until cancelled. */
  resolveWith?: InvokeResult;

  getStatus(): AgentStatusPayload {
    return { status: "ready", model: { name: "fake", quantization: "q4" } };
  }

  invoke(_messages: ConversationMessage[], onToken?: (textDelta: string) => void): Promise<InvokeResult> & { requestId: string } {
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
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
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
      body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
    });
    const body = await response.text();

    expect(body).toContain("[DONE]");
    expect(fakeAgentService.cancelledRequestIds).toEqual([]);
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
    app.use("/api/chat", createChatStatusRouter(fakeAgentService as unknown as AgentService));

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
    app.use("/api/chat", createChatStatusRouter(fakeAgentService as unknown as AgentService));

    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;

    const response = await fetch(`http://127.0.0.1:${port}/api/chat/preload/cancel`, { method: "POST" });

    expect(response.status).toBe(500);
  });
});
