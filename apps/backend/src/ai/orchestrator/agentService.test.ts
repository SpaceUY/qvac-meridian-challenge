import { describe, expect, it } from "vitest";
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
});
