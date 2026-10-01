import * as http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { ReadinessService, type ChatReadinessSource, type EmbeddingReadinessSource } from "../readinessService.js";
import { createHealthRouter, createPublicModelsRouter } from "./health.router.js";
import { MODEL_NOT_READY_ERROR } from "../../chat/chat.router.const.js";

function startApp(readiness: ReadinessService): Promise<{ server: http.Server; baseUrl: string }> {
  const app = express();
  app.use(createHealthRouter(readiness));
  app.use(createPublicModelsRouter(readiness));
  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once("listening", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

const NEVER_READY_CHAT: ChatReadinessSource = {
  getStatus: () => ({ status: "loading" }),
  preload: async () => {},
};
const NEVER_READY_EMBEDDING: EmbeddingReadinessSource = {
  embed: () => new Promise(() => {}), // never resolves
};
const ALWAYS_READY_CHAT: ChatReadinessSource = {
  getStatus: () => ({ status: "ready" }),
  preload: async () => {},
};
const ALWAYS_READY_EMBEDDING: EmbeddingReadinessSource = {
  embed: async () => [0.1],
};

describe("GET /health", () => {
  let server: http.Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });

  it("returns 503 while not ready", async () => {
    const readiness = new ReadinessService(NEVER_READY_CHAT, NEVER_READY_EMBEDDING);
    const started = await startApp(readiness);
    server = started.server;
    const res = await fetch(`${started.baseUrl}/health`);
    expect(res.status).toBe(503);
  });

  it("returns 200 {status:'ready'} once ready", async () => {
    const readiness = new ReadinessService(ALWAYS_READY_CHAT, ALWAYS_READY_EMBEDDING);
    const started = await startApp(readiness);
    server = started.server;
    await expect.poll(async () => (await fetch(`${started.baseUrl}/health`)).status).toBe(200);
    const res = await fetch(`${started.baseUrl}/health`);
    expect(await res.json()).toEqual({ status: "ready" });
  });
});

describe("GET /v1/models", () => {
  let server: http.Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });

  it("returns 503 with the model-not-ready error while the model is still loading", async () => {
    const readiness = new ReadinessService(NEVER_READY_CHAT, NEVER_READY_EMBEDDING);
    const started = await startApp(readiness);
    server = started.server;
    const res = await fetch(`${started.baseUrl}/v1/models`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: MODEL_NOT_READY_ERROR });
  });

  it("returns 200 with an OpenAI-shaped model list once ready", async () => {
    const readiness = new ReadinessService(ALWAYS_READY_CHAT, ALWAYS_READY_EMBEDDING);
    const started = await startApp(readiness);
    server = started.server;
    await expect.poll(async () => (await fetch(`${started.baseUrl}/v1/models`)).status).toBe(200);
    const body = await (await fetch(`${started.baseUrl}/v1/models`)).json() as any;
    expect(body.object).toBe("list");
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ object: "model", owned_by: "meridian" });
  });
});
