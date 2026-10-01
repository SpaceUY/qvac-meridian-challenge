import { describe, expect, it } from "vitest";
import { isCancellationError, ModelManagementError, OperationCancelledError } from "../../models/domain/errors.js";
import { ModelManagementService } from "../../models/service/models.service.js";
import type {
  ModelProvisioningPort,
  ModelRuntimePort,
} from "../../models/domain/ports.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  ModelSource,
} from "../../models/domain/types.js";
import { AgentService } from "./agentService.js";
import { RagRetrievalService } from "../../rag/service/rag.service.js";
import { FakeEmbeddingPort } from "../../rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "../../rag/infra/fixtures/corpus-chunks.fixture.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";
import {
  DocumentFormat,
  DocumentStatus,
  DocumentType,
  type ArchitectureDocument,
} from "../../document/domain/document.model.js";
import { DEFAULT_RAG_CONFIG } from "../../config/rag.config.js";
import type { RagRetrievalConfig } from "../../rag/domain/types.js";
import { INSUFFICIENT_CONTEXT_MESSAGE } from "./ragGraph.const.js";
import { LLM_MODELS_BY_TIER, WHISPER_MODEL_NAMES_BY_TIER, TTS_MODEL_NAMES_BY_TIER } from "../../config/models.config.js";

/** Immediately resolves load/chat calls; replays `responses` one per `chatComplete` call (repeating the last one), recording every request for assertions. */
class FakeModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  readonly chatRequests: ChatCompletionRequest[] = [];
  private callCount = 0;

  constructor(
    private readonly responses: ChatCompletionResult[] = [
      { text: "ok", toolCalls: [] },
    ],
  ) {}

  get lastChatRequest(): ChatCompletionRequest | undefined {
    return this.chatRequests.at(-1);
  }

  async searchRegistry() {
    return [];
  }

  async listRegistry() {
    return [];
  }

  async provision() {}

  load(source: ModelSource): Promise<LoadedModel> & { requestId: string } {
    return Object.assign(
      Promise.resolve({ modelId: "fake-model", source, loadedAt: new Date() }),
      { requestId: "req-load" },
    );
  }

  infer(): Promise<InferenceResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "" }), {
      requestId: "req-infer",
    });
  }

  chatComplete(
    _modelId: string,
    request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    this.chatRequests.push(request);
    const response =
      this.responses[Math.min(this.callCount, this.responses.length - 1)];
    this.callCount += 1;
    // Mirrors the real adapter's streaming contract: deltas sum to the full
    // text. One delta per word, so a test can tell "streamed token by token"
    // apart from "arrived in one piece".
    for (const delta of response.text.match(/\S+\s*/g) ?? []) onToken?.(delta);
    return Object.assign(Promise.resolve(response), {
      requestId: `req-chat-${this.chatRequests.length}`,
    });
  }

  async unload() {}

  async close() {}

  async cancel() {}
}

interface PendingChatCall {
  resolve: (result: ChatCompletionResult) => void;
  reject: (err: unknown) => void;
}

interface PendingLoadCall {
  resolve: (result: LoadedModel) => void;
  reject: (err: unknown) => void;
}

/**
 * Like `FakeModelRuntime` above, but `load`/`chatComplete` calls stay
 * pending until the test explicitly `settle()`s or `cancel()`s them by
 * requestId - needed to exercise `AgentService.cancel()`/`cancelPreload()`,
 * which cancel whatever call is currently in flight on the underlying
 * `ChatQVAC` model.
 */
class ControllableModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  private nextRequestId = 0;
  private readonly pendingChat = new Map<string, PendingChatCall>();
  private readonly pendingLoad = new Map<string, PendingLoadCall>();
  private readonly loadSources = new Map<string, ModelSource>();
  private readonly chatRequestIdQueue: string[] = [];
  private chatRequestWaiter?: (requestId: string) => void;
  private readonly loadRequestIdQueue: string[] = [];
  private loadRequestWaiter?: (requestId: string) => void;

  async searchRegistry() {
    return [];
  }

  async listRegistry() {
    return [];
  }

  async provision() {}

  load(source: ModelSource): Promise<LoadedModel> & { requestId: string } {
    const requestId = `req-load-${(this.nextRequestId += 1)}`;
    this.loadSources.set(requestId, source);
    const promise = new Promise<LoadedModel>((resolve, reject) => {
      this.pendingLoad.set(requestId, { resolve, reject });
    });
    if (this.loadRequestWaiter) {
      this.loadRequestWaiter(requestId);
      this.loadRequestWaiter = undefined;
    } else {
      this.loadRequestIdQueue.push(requestId);
    }
    return Object.assign(promise, { requestId });
  }

  infer(): Promise<InferenceResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "" }), {
      requestId: "req-infer",
    });
  }

  chatComplete(): Promise<ChatCompletionResult> & { requestId: string } {
    const requestId = `req-chat-${(this.nextRequestId += 1)}`;
    const promise = new Promise<ChatCompletionResult>((resolve, reject) => {
      this.pendingChat.set(requestId, { resolve, reject });
    });
    if (this.chatRequestWaiter) {
      this.chatRequestWaiter(requestId);
      this.chatRequestWaiter = undefined;
    } else {
      this.chatRequestIdQueue.push(requestId);
    }
    return Object.assign(promise, { requestId });
  }

  async unload() {}

  async close() {}

  async cancel(requestId: string) {
    const chatCall = this.pendingChat.get(requestId);
    if (chatCall) {
      this.pendingChat.delete(requestId);
      chatCall.reject(new OperationCancelledError(requestId));
      return;
    }
    const loadCall = this.pendingLoad.get(requestId);
    if (!loadCall) return; // unknown, already-settled, or already-cancelled: safe no-op
    this.pendingLoad.delete(requestId);
    loadCall.reject(new OperationCancelledError(requestId));
  }

  /** Resolves the given in-flight chat call with a fixed reply. Throws if `requestId` isn't pending. */
  settle(requestId: string, result: ChatCompletionResult = { text: "ok", toolCalls: [] }): void {
    const call = this.pendingChat.get(requestId);
    if (!call) throw new Error(`no pending chat call for requestId "${requestId}"`);
    this.pendingChat.delete(requestId);
    call.resolve(result);
  }

  /** Resolves the given in-flight load call with a synthetic result built from its own `source`. Throws if `requestId` isn't pending. */
  settleLoad(requestId: string): void {
    const call = this.pendingLoad.get(requestId);
    if (!call) throw new Error(`no pending load call for requestId "${requestId}"`);
    this.pendingLoad.delete(requestId);
    const source = this.loadSources.get(requestId)!;
    call.resolve({ modelId: `fake-model-${requestId}`, source, loadedAt: new Date() });
  }

  /** Resolves with the requestId of the next `chatComplete` call, so a test can wait for it to actually start before cancelling. */
  nextChatRequestId(): Promise<string> {
    const queued = this.chatRequestIdQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.chatRequestWaiter = resolve;
    });
  }

  /** Resolves with the requestId of the next `load` call, so a test can wait for it to actually start before cancelling. */
  nextLoadRequestId(): Promise<string> {
    const queued = this.loadRequestIdQueue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve) => {
      this.loadRequestWaiter = resolve;
    });
  }
}

/**
 * Mimics a delegated load stuck in a connection phase that never registers
 * with the runtime's own cancellation registry: `cancel()` resolves
 * successfully but never actually interrupts the in-flight `load()` call.
 * Exercises the path `QvacChatSession.cancelLoad()`'s abandon signal
 * exists for - unlike `ControllableModelRuntime` above, whose `cancel()`
 * genuinely rejects the pending load itself, this one proves the session's
 * own abandon signal actually rejects the load.
 */
class HangingLoadModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  async searchRegistry() {
    return [];
  }

  async listRegistry() {
    return [];
  }

  async provision() {}

  load(): Promise<LoadedModel> & { requestId: string } {
    return Object.assign(new Promise<LoadedModel>(() => {}), { requestId: "req-load-hang" });
  }

  infer(): Promise<InferenceResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "" }), { requestId: "req-infer" });
  }

  chatComplete(): Promise<ChatCompletionResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), { requestId: "req-chat" });
  }

  async unload() {}

  async close() {}

  async cancel() {}
}

/** In-memory `DocumentRepository` fixture - lets tests control the ingested inventory directly instead of touching `corpus/` on disk. */
class FakeDocumentRepository implements DocumentRepository {
  constructor(private readonly documents: ArchitectureDocument[]) {}

  async findAll(): Promise<ArchitectureDocument[]> {
    return this.documents;
  }

  async findById(id: string): Promise<ArchitectureDocument | null> {
    return this.documents.find((document) => document.id === id) ?? null;
  }

  async findByStatus(status: DocumentStatus): Promise<ArchitectureDocument[]> {
    return this.documents.filter((document) => document.status === status);
  }

  async findByType(type: DocumentType): Promise<ArchitectureDocument[]> {
    return this.documents.filter((document) => document.type === type);
  }

  async create(): Promise<ArchitectureDocument> {
    throw new Error("FakeDocumentRepository is read-only");
  }
}

const FAKE_DOCUMENTS: ArchitectureDocument[] = [
  {
    id: "policies/warranty-terms.md",
    title: "Warranty Terms",
    type: DocumentType.POLICIES,
    format: DocumentFormat.MARKDOWN,
    status: DocumentStatus.ACTIVE,
    tags: [],
    content: "Standard warranty covers 24 months.",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
  {
    id: "faqs/support-sla-faq.html",
    title: "Support Sla Faq",
    type: DocumentType.FAQ,
    format: DocumentFormat.HTML,
    status: DocumentStatus.ACTIVE,
    tags: [],
    content: "Enterprise P1 SLA is 4 hours.",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
  },
];

describe("AgentService model selection", () => {
  it("loads the tier-specific chat model instead of always the default tier", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
      "high",
    );

    expect(agentService.getStatus().model).toEqual({
      name: LLM_MODELS_BY_TIER.high.modelName,
      quantization: LLM_MODELS_BY_TIER.high.quantization,
    });
  });

  it("reports the resolved hardware tier in its status payload", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
      "medium",
    );

    expect(agentService.getStatus().hardwareTier).toBe("medium");
  });

  it("reports the STT and TTS model names resolved for the tier, alongside the chat model", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
      "low",
    );

    const status = agentService.getStatus();
    expect(status.sttModel).toBe(WHISPER_MODEL_NAMES_BY_TIER.low);
    expect(status.ttsModel).toBe(TTS_MODEL_NAMES_BY_TIER.low);
  });

  it("never reports providerHealth when no delegate is configured", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);
    const agentService = new AgentService(modelService, ragService, new FakeDocumentRepository([]));

    await agentService.preload();

    expect(agentService.getStatus().providerHealth).toBeUndefined();
  });
});

/** A `FakeModelRuntime` that also implements the optional `deleteCache()`, recording every key it was asked to delete. */
class CacheableModelRuntime extends FakeModelRuntime {
  readonly deletedCacheKeys: string[] = [];

  async deleteCache(kvCacheKey: string): Promise<void> {
    this.deletedCacheKeys.push(kvCacheKey);
  }
}

describe("AgentService.deleteSessionCache", () => {
  it("deletes the KV cache stored under the session id", async () => {
    const runtime = new CacheableModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);
    const agentService = new AgentService(modelService, ragService, new FakeDocumentRepository([]));

    await agentService.deleteSessionCache("session-1");

    expect(runtime.deletedCacheKeys).toEqual(["session-1"]);
  });
});

describe("AgentService.invoke", () => {
  it("sends the corpus content to the model as part of the chat history", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);

    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    // DEFAULT_RAG_CONFIG's minScore (0.65) is calibrated for the real
    // embedding model - FakeEmbeddingPort's crude hashed bag-of-words only
    // scores ~0.14 for this query against the actually-relevant chunk, so
    // this test needs its own lower threshold to exercise real evidence
    // instead of always falling through to "no evidence".
    const ragService = new RagRetrievalService(embeddingPort, vectorStore, {
      topK: 5,
      minScore: 0.1,
      maxContextChunks: 4,
      dedupeExactContent: true,
    });

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
    );

    await agentService.invoke([
      { role: "user", message: "What's the warranty policy?" },
    ]);

    const history = runtime.lastChatRequest?.history ?? [];
    expect(
      history.some(
        (message) =>
          message.role === "system" &&
          // CORPUS_CHUNK_FIXTURES' actual wording (not "Standard warranty
          // covers 24 months." - that's FAKE_DOCUMENTS' text, used by the
          // list_documents test below, a different fixture entirely).
          message.content.includes("Standard hardware warranty"),
      ),
    ).toBe(true);
  });

  it("invokes list_documents when the model requests it and feeds the real inventory back for the final answer", async () => {
    const runtime = new FakeModelRuntime([
      {
        text: "",
        toolCalls: [{ id: "call_1", name: "list_documents", arguments: {} }],
      },
      { text: "There are 2 documents ingested.", toolCalls: [] },
    ]);
    const modelService = new ModelManagementService(runtime, runtime);

    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository(FAKE_DOCUMENTS),
    );

    const result = await agentService.invoke([
      { role: "user", message: "What documents are currently ingested?" },
    ]);

    expect(result.answer).toBe("There are 2 documents ingested.");
    expect(runtime.chatRequests).toHaveLength(2);

    const secondRequestHistory = runtime.chatRequests[1].history;
    const toolMessage = secondRequestHistory.find(
      (message) => message.role === "tool",
    );
    expect(toolMessage?.content).toContain("policies/warranty-terms.md");
    expect(toolMessage?.content).toContain("faqs/support-sla-faq.html");
  });

  it("reports which tool the model used when it calls list_documents", async () => {
    const runtime = new FakeModelRuntime([
      {
        text: "",
        toolCalls: [{ id: "call_1", name: "list_documents", arguments: {} }],
      },
      { text: "There are 2 documents ingested.", toolCalls: [] },
    ]);
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);
    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository(FAKE_DOCUMENTS),
    );

    const result = await agentService.invoke([
      { role: "user", message: "What documents are currently ingested?" },
    ]);

    expect(result.toolsUsed).toEqual(["list_documents"]);
  });

  it("reports lookup_stock as the tool used for a stock question", async () => {
    const runtime = new FakeModelRuntime([
      {
        text: "",
        toolCalls: [{ id: "call_1", name: "lookup_stock", arguments: { sku: "SD-X4-001" } }],
      },
      { text: "SD-X4-001 has 22 units available.", toolCalls: [] },
    ]);
    const agent = await buildAgent(runtime, ALWAYS_EVIDENCE_CONFIG);

    const result = await agent.invoke([
      { role: "user", message: "How many SD-X4-001 are in stock?" },
    ]);

    expect(result.toolsUsed).toEqual(["lookup_stock"]);
  });

  it("reports no tools used for an answer that only used RAG", async () => {
    const runtime = new FakeModelRuntime([{ text: "Enterprise P1 SLA is 4 hours.", toolCalls: [] }]);
    const agent = await buildAgentWithPermissiveRag(runtime);

    const result = await agent.invoke([{ role: "user", message: "What is the P1 SLA?" }]);

    expect(result.toolsUsed).toEqual([]);
  });

  it("forwards an attached image through the graph to the model", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);

    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
    );

    const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0xdb]);
    await agentService.invoke([
      {
        role: "user",
        message: "what's wrong with this part?",
        images: [{ mimeType: "image/jpeg", data: imageBytes }],
      },
    ]);

    const history = runtime.lastChatRequest?.history ?? [];
    const humanEntry = history.find((entry) => entry.role === "user");
    expect(humanEntry?.images).toEqual([{ mimeType: "image/jpeg", data: imageBytes }]);
  });

  it("forwards temperature and seed from invoke() options to the underlying chat request", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);
    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);
    const agentService = new AgentService(modelService, ragService, new FakeDocumentRepository([]));

    await agentService.invoke(
      [{ role: "user", message: "What was Q2 revenue?" }],
      { temperature: 0.15, seed: 999 },
    );

    expect(runtime.lastChatRequest?.temperature).toBe(0.15);
    expect(runtime.lastChatRequest?.seed).toBe(999);
  });

  it("cancels an in-flight invoke without leaving the model unusable for a follow-up invoke", async () => {
    const runtime = new ControllableModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);

    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
    );

    const pending = agentService.invoke([
      { role: "user", message: "What's the warranty policy?" },
    ]);
    runtime.settleLoad(await runtime.nextLoadRequestId());
    const chatRequestId = await runtime.nextChatRequestId();

    await agentService.cancel(pending.requestId);

    await expect(pending).rejects.toBeInstanceOf(ModelManagementError);

    const followUp = agentService.invoke([
      { role: "user", message: "Ask again" },
    ]);
    const followUpChatRequestId = await runtime.nextChatRequestId();
    expect(followUpChatRequestId).not.toBe(chatRequestId);
    runtime.settle(followUpChatRequestId, { text: "hi again", toolCalls: [] });

    // Not asserting on the exact answer text: the grounding fallback in
    // graph.ts's buildLlmNode may substitute a fixed message when this
    // fixture setup finds no RAG evidence, independent of cancellation.
    // What matters here is that the model is still usable at all.
    await expect(followUp).resolves.toEqual(
      expect.objectContaining({ answer: expect.any(String) }),
    );
  });

  it("cancels an in-flight model load without leaving the agent unable to load a model afterward", async () => {
    const runtime = new ControllableModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);

    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
    );

    const preloadPromise = agentService.preload();
    const loadRequestId = await runtime.nextLoadRequestId();
    expect(agentService.getStatus().status).toBe("loading");

    await agentService.cancelPreload();

    await expect(preloadPromise).rejects.toBeInstanceOf(ModelManagementError);
    // A cancelled load isn't a genuine failure: the agent should be ready
    // to try loading again, not stuck showing an error.
    expect(agentService.getStatus().status).toBe("idle");

    const secondPreload = agentService.preload();
    const secondLoadRequestId = await runtime.nextLoadRequestId();
    expect(secondLoadRequestId).not.toBe(loadRequestId);
    runtime.settleLoad(secondLoadRequestId);

    await secondPreload;
    expect(agentService.getStatus().status).toBe("ready");
  });

  it("resolves to idle (not stuck on error) when cancelling a load whose own cancel() cannot truly interrupt it", async () => {
    const runtime = new HangingLoadModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);

    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(
      modelService,
      ragService,
      new FakeDocumentRepository([]),
    );

    const preloadPromise = agentService.preload();
    expect(agentService.getStatus().status).toBe("loading");

    await agentService.cancelPreload();

    const err = await preloadPromise.catch((caught: unknown) => caught);
    expect(isCancellationError(err)).toBe(true);
    expect(agentService.getStatus().status).toBe("idle");
  });
});

/** Cosine similarity never exceeds 1, so no chunk clears this: retrieval never finds evidence. */
const NO_EVIDENCE_CONFIG: RagRetrievalConfig = { ...DEFAULT_RAG_CONFIG, minScore: 1.01 };
/** Cosine similarity is never below -1, so every chunk clears this: retrieval always finds evidence. */
const ALWAYS_EVIDENCE_CONFIG: RagRetrievalConfig = { ...DEFAULT_RAG_CONFIG, minScore: -1 };

async function buildAgent(runtime: FakeModelRuntime, ragConfig: RagRetrievalConfig): Promise<AgentService> {
  const embeddingPort = new FakeEmbeddingPort();
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  return new AgentService(
    new ModelManagementService(runtime, runtime),
    new RagRetrievalService(embeddingPort, vectorStore, ragConfig),
    new FakeDocumentRepository([]),
  );
}

/** Runs one user turn and joins every text delta: exactly what an SSE client would render. */
async function askOnce(agent: AgentService, question: string) {
  const deltas: string[] = [];
  const result = await agent.invoke(
    [{ role: "user", message: question }],
    undefined,
    (delta) => deltas.push(delta),
  );
  return { deltas, onScreen: deltas.join(""), result };
}

describe("AgentService.invoke streaming", () => {
  it("never puts a reply the grounding guard discarded on screen", async () => {
    const runtime = new FakeModelRuntime([
      { text: "The standard warranty is 3 years.", toolCalls: [] },
    ]);
    const agent = await buildAgent(runtime, NO_EVIDENCE_CONFIG);

    const { onScreen, result } = await askOnce(agent, "What is the standard warranty?");

    expect(result.answer).toBe(INSUFFICIENT_CONTEXT_MESSAGE);
    expect(onScreen).toBe(result.answer);
  });

  it("streams a grounded reply token by token", async () => {
    const reply = "Standard warranty covers 24 months.";
    const runtime = new FakeModelRuntime([{ text: reply, toolCalls: [] }]);
    const agent = await buildAgent(runtime, ALWAYS_EVIDENCE_CONFIG);

    const { deltas, onScreen, result } = await askOnce(agent, "What is the standard warranty?");

    expect(result.answer).toBe(reply);
    expect(onScreen).toBe(result.answer);
    expect(deltas.length).toBeGreaterThan(1);
  });

  it("streams the reply that follows a tool call, even without evidence", async () => {
    const reply = "SD-X4-001 has 22 units available in the Americas.";
    const runtime = new FakeModelRuntime([
      {
        text: "",
        toolCalls: [{ id: "call_1", name: "lookup_stock", arguments: { sku: "SD-X4-001" } }],
      },
      { text: reply, toolCalls: [] },
    ]);
    const agent = await buildAgent(runtime, NO_EVIDENCE_CONFIG);

    const { deltas, onScreen, result } = await askOnce(agent, "How many SD-X4-001 are in stock?");

    expect(result.answer).toBe(reply);
    expect(onScreen).toBe(result.answer);
    expect(deltas.length).toBeGreaterThan(1);
  });
});

/** Lets every fixture chunk through: these tests are about what AgentService does WITH chunks, not about the threshold (FakeEmbeddingPort scores are not real similarities). */
const PERMISSIVE_RAG_CONFIG = { topK: 5, minScore: -1, maxContextChunks: 4, dedupeExactContent: true };

async function buildAgentWithPermissiveRag(runtime: FakeModelRuntime): Promise<AgentService> {
  const embeddingPort = new FakeEmbeddingPort();
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  return new AgentService(
    new ModelManagementService(runtime, runtime),
    new RagRetrievalService(embeddingPort, vectorStore, PERMISSIVE_RAG_CONFIG),
    new FakeDocumentRepository([]),
  );
}

describe("AgentService.invoke citations", () => {
  it("returns one citation per retrieved document for a grounded answer", async () => {
    const runtime = new FakeModelRuntime([{ text: "Enterprise P1 SLA is 4 hours.", toolCalls: [] }]);
    const agent = await buildAgentWithPermissiveRag(runtime);

    const result = await agent.invoke([{ role: "user", message: "What is the P1 SLA?" }]);

    const retrievedFiles = new Set(result.chunks.map((chunk) => chunk.source));
    expect(result.citations.length).toBeGreaterThan(0);
    expect(result.citations).toHaveLength(retrievedFiles.size);
    for (const citation of result.citations) {
      expect(retrievedFiles.has(citation.file)).toBe(true);
      expect(typeof citation.score).toBe("number");
    }
  });

  it("returns no citations when the model answers that the documents don't cover it", async () => {
    const runtime = new FakeModelRuntime([
      { text: "The available documents do not contain enough information to answer this question.", toolCalls: [] },
    ]);
    const agent = await buildAgentWithPermissiveRag(runtime);

    const result = await agent.invoke([{ role: "user", message: "Who is the CEO?" }]);

    expect(result.chunks.length).toBeGreaterThan(0); // retrieval DID find something...
    expect(result.citations).toEqual([]); // ...but the answer used none of it
  });
});
