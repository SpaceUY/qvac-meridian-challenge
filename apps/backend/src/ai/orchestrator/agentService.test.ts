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

/** Immediately resolves load/chat calls and records the last chat request for assertions. */
class FakeModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  lastChatRequest?: ChatCompletionRequest;

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

  async chatComplete(
    _modelId: string,
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> {
    this.lastChatRequest = request;
    return { text: "ok", toolCalls: [] };
  }

  async embed(_modelId: string, texts: string[]): Promise<number[][]> {
    return texts.map(() => [1]);
  }

  async unload() {}

  async close() {}

  async cancel() {}
}

describe("AgentService.invoke", () => {
  it("sends the corpus content to the model as part of the chat history", async () => {
    const runtime = new FakeModelRuntime();
    const modelService = new ModelManagementService(runtime, runtime);

    const embeddingPort = new FakeEmbeddingPort();
    const vectorStore = await buildFixtureVectorStore(embeddingPort);
    const ragService = new RagRetrievalService(embeddingPort, vectorStore);

    const agentService = new AgentService(modelService, ragService);

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
});
