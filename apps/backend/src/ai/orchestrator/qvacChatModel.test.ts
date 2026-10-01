import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { ChatQVAC, hasImageContent } from "./qvacChatModel.js";
import { ModelManagementService } from "../../models/service/models.service.js";
import type { ModelProvisioningPort, ModelRuntimePort } from "../../models/domain/ports.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  ModelSource,
} from "../../models/domain/types.js";

/** Immediately resolves load/chat calls, recording every request for assertions - same shape as `agentService.test.ts`'s own fixture. */
class FakeModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  readonly chatRequests: ChatCompletionRequest[] = [];

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
    return Object.assign(Promise.resolve({ text: "" }), { requestId: "req-infer" });
  }

  chatComplete(
    _modelId: string,
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    this.chatRequests.push(request);
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), {
      requestId: `req-chat-${this.chatRequests.length}`,
    });
  }

  async unload() {}

  async close() {}

  async cancel() {}
}

const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x01, 0x02, 0x03]);

const FAKE_SOURCE: ModelSource = {
  kind: "registry",
  registryPath: "fake/path",
  registrySource: "hf",
};

describe("hasImageContent", () => {
  it("is false for a text-only message", () => {
    expect(hasImageContent(new HumanMessage("hello"))).toBe(false);
  });

  it("is true when content includes an image block", () => {
    const message = new HumanMessage({
      content: [
        { type: "text", text: "what's this?" },
        { type: "image", mimeType: "image/jpeg", data: JPEG_BYTES },
      ],
    });
    expect(hasImageContent(message)).toBe(true);
  });
});

describe("ChatQVAC image forwarding", () => {
  it("forwards an image content block as ChatMessage.images", async () => {
    const runtime = new FakeModelRuntime();
    const service = new ModelManagementService(runtime, runtime);
    const model = new ChatQVAC({ service, modelSource: FAKE_SOURCE });

    await model.invoke([
      new HumanMessage({
        content: [
          { type: "text", text: "what's wrong with this part?" },
          { type: "image", mimeType: "image/jpeg", data: JPEG_BYTES },
        ],
      }),
    ]);

    const history = runtime.lastChatRequest?.history ?? [];
    const humanEntry = history.find((entry) => entry.role === "user");
    expect(humanEntry?.content).toBe("what's wrong with this part?");
    expect(humanEntry?.images).toEqual([{ mimeType: "image/jpeg", data: JPEG_BYTES }]);
  });

  it("omits images for a text-only message", async () => {
    const runtime = new FakeModelRuntime();
    const service = new ModelManagementService(runtime, runtime);
    const model = new ChatQVAC({ service, modelSource: FAKE_SOURCE });

    await model.invoke([new HumanMessage("hello")]);

    const history = runtime.lastChatRequest?.history ?? [];
    expect(history[0]?.images).toBeUndefined();
  });
});
