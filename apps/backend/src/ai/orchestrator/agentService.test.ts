import { describe, expect, it } from "vitest";
import { ModelManagementError, OperationCancelledError } from "../../models/domain/errors.js";
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
    // text, so a single delta with the whole response satisfies it here.
    if (response.text) onToken?.(response.text);
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

describe("AgentService.invoke", () => {
  it("sends the corpus content to the model as part of the chat history", async () => {
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

    await agentService.invoke([
      { role: "user", message: "What's the warranty policy?" },
    ]);

    const history = runtime.lastChatRequest?.history ?? [];
    expect(
      history.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("Standard warranty"),
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
