import { describe, expect, it } from "vitest";
import { HumanMessage } from "@langchain/core/messages";
import { ModelManagementService } from "../../models/service/models.service.js";
import { DelegatedProviderUnreachableError } from "../../models/domain/errors.js";
import type { ModelProvisioningPort, ModelRuntimePort } from "../../models/domain/ports.js";
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadedModelDelegationInfo,
  LoadModelOptions,
  ModelSource,
} from "../../models/domain/types.js";
import { ChatQVAC, hasImageContent } from "./qvacChatModel.js";

/** Records the `options` passed to `load()`; resolves immediately with a fixed model id. Records every `getLoadedModelInfo()` call so tests can assert whether it was even attempted. */
class RecordingModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  lastLoadOptions?: LoadModelOptions;
  loadCallCount = 0;
  getLoadedModelInfoCalls: string[] = [];
  delegationInfoResult: LoadedModelDelegationInfo | "throw" = { isDelegated: false };
  /** `chatComplete()`'s outcome per call, consumed in order; a call past the end of this array succeeds. `"provider-unreachable"` rejects with a `DelegatedProviderUnreachableError`. */
  chatCompleteOutcomes: Array<"succeed" | "provider-unreachable" | "genuine-failure"> = [];
  chatCompleteCallCount = 0;
  /** Ordered log of `"load"`/`"unload:<modelId>"` calls, so tests can assert the unload-before-reload sequence that clears a stale delegated registry entry. */
  operations: string[] = [];
  /** When true, `load()` returns a promise that never settles - simulates a delegated connection attempt stuck in `@qvac/sdk`'s cancellation-registry-less connect phase (see `ChatQVAC.cancelLoad`'s doc comment). */
  hangLoad = false;

  async searchRegistry() {
    return [];
  }

  async listRegistry() {
    return [];
  }

  async provision() {}

  load(source: ModelSource, options?: LoadModelOptions): Promise<LoadedModel> & { requestId: string } {
    this.loadCallCount += 1;
    this.lastLoadOptions = options;
    this.operations.push("load");
    const promise = this.hangLoad
      ? new Promise<LoadedModel>(() => {})
      : Promise.resolve({ modelId: "fake-model", source, loadedAt: new Date() });
    return Object.assign(promise, { requestId: `req-load-${this.loadCallCount}` });
  }

  infer(): Promise<InferenceResult> & { requestId: string } {
    return Object.assign(Promise.resolve({ text: "" }), { requestId: "req-infer" });
  }

  chatComplete(
    _modelId: string,
    _request: ChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<ChatCompletionResult> & { requestId: string } {
    this.chatCompleteCallCount += 1;
    const requestId = `req-chat-${this.chatCompleteCallCount}`;
    const outcome = this.chatCompleteOutcomes.shift() ?? "succeed";
    if (outcome === "provider-unreachable") {
      return Object.assign(Promise.reject(new DelegatedProviderUnreachableError()), { requestId });
    }
    if (outcome === "genuine-failure") {
      return Object.assign(Promise.reject(new Error("the model crashed")), { requestId });
    }
    onToken?.("ok");
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), { requestId });
  }

  async unload(modelId: string) {
    this.operations.push(`unload:${modelId}`);
  }

  async close() {}

  async cancel() {}

  async getLoadedModelInfo(modelId: string): Promise<LoadedModelDelegationInfo> {
    this.getLoadedModelInfoCalls.push(modelId);
    if (this.delegationInfoResult === "throw") throw new Error("boom");
    return this.delegationInfoResult;
  }
}

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

describe("ChatQVAC.ensureModel", () => {
  it("forwards a configured delegate to the model load", async () => {
    const runtime = new RecordingModelRuntime();
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    await chatModel.ensureModel();

    expect(runtime.lastLoadOptions?.delegate).toEqual(delegate);
  });

  it("omits delegate when none is configured", async () => {
    const runtime = new RecordingModelRuntime();
    const service = new ModelManagementService(runtime, runtime);

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await chatModel.ensureModel();

    expect(runtime.lastLoadOptions?.delegate).toBeUndefined();
  });
});

describe("ChatQVAC.cancelLoad", () => {
  it("rejects ensureModel()'s pending promise even when the underlying load never settles", async () => {
    // Simulates a delegated connection attempt stuck in @qvac/sdk's
    // cancellation-registry-less connect phase (confirmed against the SDK
    // source: handleLoadModelDelegated's connect phase never registers
    // with the request registry cancel() checks, so a cancel() call
    // during that phase returns success without interrupting anything -
    // this is the "cancel does not respond" bug being fixed).
    const runtime = new RecordingModelRuntime();
    runtime.hangLoad = true;
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    const pending = chatModel.ensureModel();
    await Promise.resolve(); // let ensureModel() actually start the load

    await chatModel.cancelLoad();

    await expect(pending).rejects.toMatchObject({ stage: "cancel" });
  });

  it("does not disturb a load that settles normally (no lingering rejection after success)", async () => {
    const runtime = new RecordingModelRuntime();
    const service = new ModelManagementService(runtime, runtime);
    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel.ensureModel()).resolves.toBe("fake-model");
    await expect(chatModel.cancelLoad()).resolves.toBeUndefined();
  });

  it("is a safe no-op when nothing is loading", async () => {
    const runtime = new RecordingModelRuntime();
    const service = new ModelManagementService(runtime, runtime);
    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel.cancelLoad()).resolves.toBeUndefined();
  });
});

describe("ChatQVAC.getDelegationInfo", () => {
  it("returns the runtime's delegation info once a delegated load has resolved", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    await expect(chatModel.getDelegationInfo()).resolves.toEqual({
      isDelegated: true,
      providerPublicKey: "pk-abc",
    });
    expect(runtime.getLoadedModelInfoCalls).toEqual(["fake-model"]);
  });

  it("resolves undefined without querying the runtime when no delegate is configured", async () => {
    const runtime = new RecordingModelRuntime();
    const service = new ModelManagementService(runtime, runtime);

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel.getDelegationInfo()).resolves.toBeUndefined();
    expect(runtime.getLoadedModelInfoCalls).toEqual([]);
  });

  it("resolves undefined (best-effort) if the introspection query itself fails", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegationInfoResult = "throw";
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    await expect(chatModel.getDelegationInfo()).resolves.toBeUndefined();
  });
});

describe("ChatQVAC.getCachedDelegationInfo", () => {
  it("is undefined before getDelegationInfo() has ever resolved", () => {
    const runtime = new RecordingModelRuntime();
    const service = new ModelManagementService(runtime, runtime);
    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    expect(chatModel.getCachedDelegationInfo()).toBeUndefined();
  });

  it("reflects the last getDelegationInfo() result synchronously", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };
    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    await chatModel.getDelegationInfo();

    expect(chatModel.getCachedDelegationInfo()).toEqual({
      isDelegated: true,
      providerPublicKey: "pk-abc",
    });
  });
});

const CALL_OPTIONS = {} as Parameters<ChatQVAC["_generate"]>[1];

describe("ChatQVAC._generate delegation recovery", () => {
  it("recovers by reloading and retrying once when the delegated provider is unreachable", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });
    // Simulates the state right after a successful *initial* delegated
    // preload, before the provider died - matches what AgentService.preload()
    // would have cached via getDelegationInfo() at startup.
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await chatModel.getDelegationInfo();

    // Once recovery has happened, the (now local) fallback model is what
    // a fresh introspection query reports - this stubs that answer.
    runtime.delegationInfoResult = { isDelegated: false };
    const result = await chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS);

    expect(result.generations[0]?.text).toBe("ok");
    expect(runtime.loadCallCount).toBe(2); // the initial load, plus one reload on recovery
    // Unloading the stale (still delegated, per @qvac/sdk's registry) model
    // BEFORE reloading is what makes the reload a genuine local load rather
    // than a same-modelId no-op (dist/server/bare/ops/load-model.js's
    // isModelLoaded() short-circuit) that would leave it delegated forever.
    expect(runtime.operations).toEqual(["load", "unload:fake-model", "load"]);
    // The engine panel (GET /api/chat/status -> AgentStatusPayload.delegation)
    // must reflect the recovery, not the stale "still delegated" snapshot
    // from before the provider died.
    expect(chatModel.getCachedDelegationInfo()).toEqual({ isDelegated: false });
  });

  it("does not retry (or reload) on a genuine completion failure", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.chatCompleteOutcomes = ["genuine-failure"];
    const service = new ModelManagementService(runtime, runtime);

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS)).rejects.toThrow(
      "the model crashed",
    );
    expect(runtime.loadCallCount).toBe(1); // no reload attempted
  });

  it("surfaces the original error if recovery itself also fails to complete", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.chatCompleteOutcomes = ["provider-unreachable", "provider-unreachable"];
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    // Only one retry is attempted - a second consecutive failure propagates.
    await expect(chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS)).rejects.toBeTruthy();
    expect(runtime.loadCallCount).toBe(2);
  });
});

describe("ChatQVAC._streamResponseChunks delegation recovery", () => {
  it("recovers by reloading and retrying once when the provider dies before any token is streamed", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    const service = new ModelManagementService(runtime, runtime);
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    const chunks = [];
    for await (const chunk of chatModel._streamResponseChunks([new HumanMessage("hi")], CALL_OPTIONS)) {
      chunks.push(chunk.text);
    }

    expect(chunks).toContain("ok");
    expect(runtime.loadCallCount).toBe(2);
    expect(runtime.operations).toEqual(["load", "unload:fake-model", "load"]);
  });

  it("does not retry a genuine completion failure while streaming", async () => {
    const runtime = new RecordingModelRuntime();
    runtime.chatCompleteOutcomes = ["genuine-failure"];
    const service = new ModelManagementService(runtime, runtime);

    const chatModel = new ChatQVAC({
      service,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(async () => {
      for await (const _chunk of chatModel._streamResponseChunks([new HumanMessage("hi")], CALL_OPTIONS)) {
        // draining the generator
      }
    }).rejects.toThrow("the model crashed");
    expect(runtime.loadCallCount).toBe(1);
  });
});

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

describe("ChatQVAC per-call temperature/seed override", () => {
  it("uses the per-call temperature/seed override instead of the constructor default", async () => {
    const runtime = new FakeModelRuntime();
    const model = new ChatQVAC({
      service: new ModelManagementService(runtime, runtime),
      modelSource: { kind: "url", url: "https://example.test/model.gguf" },
      temperature: 0,
    });

    await model.invoke([new HumanMessage("hi")], { temperature: 0.9, seed: 123 });

    expect(runtime.lastChatRequest?.temperature).toBe(0.9);
    expect(runtime.lastChatRequest?.seed).toBe(123);
  });

  it("falls back to the constructor default temperature when no override is given", async () => {
    const runtime = new FakeModelRuntime();
    const model = new ChatQVAC({
      service: new ModelManagementService(runtime, runtime),
      modelSource: { kind: "url", url: "https://example.test/model.gguf" },
      temperature: 0.4,
    });

    await model.invoke([new HumanMessage("hi")]);

    expect(runtime.lastChatRequest?.temperature).toBe(0.4);
    expect(runtime.lastChatRequest?.seed).toBeUndefined();
  });
});
