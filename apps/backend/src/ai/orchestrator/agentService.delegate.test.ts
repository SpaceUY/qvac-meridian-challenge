import { describe, expect, it, vi } from "vitest";
import { ModelManagementService } from "../../models/service/models.service.js";
import { DelegatedProviderUnreachableError } from "../../models/domain/errors.js";
import type { ModelProvisioningPort, ModelRuntimePort } from "../../models/domain/ports.js";
import type {
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadedModelDelegationInfo,
  LoadModelOptions,
  ModelSource,
} from "../../models/domain/types.js";
import { RagRetrievalService } from "../../rag/service/rag.service.js";
import { FakeEmbeddingPort } from "../../rag/infra/fakeEmbedding.adapter.js";
import { buildFixtureVectorStore } from "../../rag/infra/fixtures/corpus-chunks.fixture.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";

const DELEGATE = { providerPublicKey: "pk-abc", fallbackToLocal: true };

vi.mock("../../config/delegate.config.js", () => ({ DELEGATE_CONFIG: DELEGATE }));

const { AgentService } = await import("./agentService.js");

class EmptyDocumentRepository implements DocumentRepository {
  async findAll() {
    return [];
  }

  async findById() {
    return null;
  }

  async findByStatus() {
    return [];
  }

  async findByType() {
    return [];
  }

  async create(): Promise<never> {
    throw new Error("EmptyDocumentRepository is read-only");
  }
}

/** Records the `options` passed to `load()`; resolves immediately with a fixed model id. */
class RecordingModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  lastLoadOptions?: LoadModelOptions;
  delegationInfoResult: LoadedModelDelegationInfo = { isDelegated: true, providerPublicKey: "pk-abc" };
  /** `chatComplete()`'s outcome per call, consumed in order; a call past the end of this array succeeds. */
  chatCompleteOutcomes: Array<"succeed" | "provider-unreachable"> = [];

  async searchRegistry() {
    return [];
  }

  async listRegistry() {
    return [];
  }

  async provision() {}

  load(source: ModelSource, options?: LoadModelOptions): Promise<LoadedModel> & { requestId: string } {
    this.lastLoadOptions = options;
    return Object.assign(
      Promise.resolve({ modelId: "fake-model", source, loadedAt: new Date() }),
      { requestId: "req-load" },
    );
  }

  infer(): Promise<InferenceResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "" }), { requestId: "req-infer" });
  }

  chatComplete(
    _modelId: string,
    _request: unknown,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    const requestId = `req-chat-${Math.random()}`;
    const outcome = this.chatCompleteOutcomes.shift() ?? "succeed";
    if (outcome === "provider-unreachable") {
      return Object.assign(Promise.reject(new DelegatedProviderUnreachableError()), { requestId });
    }
    onToken?.("ok");
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), { requestId });
  }

  async unload() {}

  async close() {}

  async cancel() {}

  async getLoadedModelInfo(): Promise<LoadedModelDelegationInfo> {
    return this.delegationInfoResult;
  }
}

async function buildAgentService(runtime: RecordingModelRuntime) {
  const modelService = new ModelManagementService(runtime, runtime);
  const embeddingPort = new FakeEmbeddingPort();
  const vectorStore = await buildFixtureVectorStore(embeddingPort);
  const ragService = new RagRetrievalService(embeddingPort, vectorStore);
  return new AgentService(modelService, ragService, new EmptyDocumentRepository());
}

describe("AgentService delegate wiring", () => {
  it("passes the configured DELEGATE_CONFIG through to the chat model's load", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);

    await agentService.preload();

    expect(runtime.lastLoadOptions?.delegate).toEqual(DELEGATE);
  });

  it("reports delegation info once the model is ready", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const agentService = await buildAgentService(runtime);

    await agentService.preload();

    expect(agentService.getStatus()).toMatchObject({
      status: "ready",
      delegation: { isDelegated: true, providerPublicKey: "pk-abc" },
    });
  });

  it("omits delegation info from status until it's known (not present before preload)", async () => {
    const runtime = new RecordingModelRuntime();
    const agentService = await buildAgentService(runtime);

    expect(agentService.getStatus().delegation).toBeUndefined();
  });

  it("refreshes status once the model recovers from a dead provider mid-session", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const agentService = await buildAgentService(runtime);
    await agentService.preload();
    expect(agentService.getStatus().delegation).toEqual({
      isDelegated: true,
      providerPublicKey: "pk-abc",
    });

    // The provider is now dead: the first chat completion fails, recovery
    // reloads locally, and the retry succeeds - a fresh introspection
    // query at that point reports local, not delegated.
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    runtime.delegationInfoResult = { isDelegated: false };
    await agentService.invoke([{ role: "user", message: "hi" }]);

    // The engine panel (GET /api/chat/status) must reflect the recovery,
    // not the stale "still delegated" snapshot cached at preload time.
    expect(agentService.getStatus().delegation).toEqual({ isDelegated: false });
  });
});
