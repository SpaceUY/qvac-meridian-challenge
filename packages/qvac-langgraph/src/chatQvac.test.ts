import { describe, expect, it } from "vitest";
import * as z from "zod";
import { HumanMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { ChatQVAC, hasImageContent } from "./chatQvac.js";
import type {
  QvacChatCompletionRequest,
  QvacChatCompletionResult,
  QvacLoadedModelDelegationInfo,
  QvacModelPort,
  QvacModelSource,
} from "./types.js";

/** Thrown by the fakes below to simulate a delegated provider dying mid-session, in place of any specific backend's own error taxonomy. */
class TestProviderUnreachableError extends Error {}

/** Mirrors the shape a real host application's `createCancelledError` hook would build (e.g. this repo's `ModelManagementError` tagged with `stage: "cancel"`), so a test can assert on it without depending on any specific backend's error classes. */
function createTestCancelledError(requestId: string): Error & { stage: string } {
  return Object.assign(new Error(`Operation "${requestId}" was cancelled`), { stage: "cancel" });
}

/** Records the `options` passed to `loadModel()`; resolves immediately with a fixed model id. Records every `getLoadedModelInfo()` call so tests can assert whether it was even attempted. */
class RecordingQvacModelPort implements QvacModelPort {
  lastLoadOptions?: Parameters<QvacModelPort["loadModel"]>[1];
  loadCallCount = 0;
  getLoadedModelInfoCalls: string[] = [];
  delegationInfoResult: QvacLoadedModelDelegationInfo | "throw" = { isDelegated: false };
  /** `chatComplete()`'s outcome per call, consumed in order; a call past the end of this array succeeds. `"provider-unreachable"` rejects with a `TestProviderUnreachableError`. */
  chatCompleteOutcomes: Array<"succeed" | "provider-unreachable" | "genuine-failure"> = [];
  chatCompleteCallCount = 0;
  /** Ordered log of `"load"`/`"unload:<modelId>"` calls, so tests can assert the unload-before-reload sequence that clears a stale delegated registry entry. */
  operations: string[] = [];
  /** When true, `loadModel()` returns a promise that never settles - simulates a delegated connection attempt stuck mid-connect (see `ChatQVAC.cancelLoad`'s doc comment). */
  hangLoad = false;

  loadModel(
    _source: QvacModelSource,
    options?: Parameters<QvacModelPort["loadModel"]>[1],
  ): Promise<{ modelId: string }> & { requestId: string } {
    this.loadCallCount += 1;
    this.lastLoadOptions = options;
    this.operations.push("load");
    const promise = this.hangLoad
      ? new Promise<{ modelId: string }>(() => {})
      : Promise.resolve({ modelId: "fake-model" });
    return Object.assign(promise, { requestId: `req-load-${this.loadCallCount}` });
  }

  chatComplete(
    _modelId: string,
    _request: QvacChatCompletionRequest,
    onToken?: (textDelta: string) => void,
  ): Promise<QvacChatCompletionResult> & { requestId: string } {
    this.chatCompleteCallCount += 1;
    const requestId = `req-chat-${this.chatCompleteCallCount}`;
    const outcome = this.chatCompleteOutcomes.shift() ?? "succeed";
    if (outcome === "provider-unreachable") {
      return Object.assign(Promise.reject(new TestProviderUnreachableError()), { requestId });
    }
    if (outcome === "genuine-failure") {
      return Object.assign(Promise.reject(new Error("the model crashed")), { requestId });
    }
    onToken?.("ok");
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), { requestId });
  }

  async cancel(): Promise<void> {}

  async unloadModel(modelId: string): Promise<void> {
    this.operations.push(`unload:${modelId}`);
  }

  async getLoadedModelInfo(modelId: string): Promise<QvacLoadedModelDelegationInfo> {
    this.getLoadedModelInfoCalls.push(modelId);
    if (this.delegationInfoResult === "throw") throw new Error("boom");
    return this.delegationInfoResult;
  }
}

/** Immediately resolves load/chat calls, recording every request for assertions. */
class FakeQvacModelPort implements QvacModelPort {
  readonly chatRequests: QvacChatCompletionRequest[] = [];

  get lastChatRequest(): QvacChatCompletionRequest | undefined {
    return this.chatRequests.at(-1);
  }

  loadModel(): Promise<{ modelId: string }> & { requestId: string } {
    return Object.assign(Promise.resolve({ modelId: "fake-model" }), { requestId: "req-load" });
  }

  chatComplete(
    _modelId: string,
    request: QvacChatCompletionRequest,
  ): Promise<QvacChatCompletionResult> & { requestId: string } {
    this.chatRequests.push(request);
    return Object.assign(Promise.resolve({ text: "ok", toolCalls: [] }), {
      requestId: `req-chat-${this.chatRequests.length}`,
    });
  }

  async cancel(): Promise<void> {}

  async unloadModel(): Promise<void> {}

  async getLoadedModelInfo(): Promise<QvacLoadedModelDelegationInfo> {
    return { isDelegated: false };
  }
}

describe("ChatQVAC.ensureModel", () => {
  it("forwards a configured delegate to the model load", async () => {
    const runtime = new RecordingQvacModelPort();
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    await chatModel.ensureModel();

    expect(runtime.lastLoadOptions?.delegate).toEqual(delegate);
  });

  it("omits delegate when none is configured", async () => {
    const runtime = new RecordingQvacModelPort();

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await chatModel.ensureModel();

    expect(runtime.lastLoadOptions?.delegate).toBeUndefined();
  });
});

describe("ChatQVAC.cancelLoad", () => {
  it("rejects ensureModel()'s pending promise even when the underlying load never settles", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.hangLoad = true;
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
      createCancelledError: createTestCancelledError,
    });

    const pending = chatModel.ensureModel();
    await Promise.resolve(); // let ensureModel() actually start the load

    await chatModel.cancelLoad();

    await expect(pending).rejects.toMatchObject({ stage: "cancel" });
  });

  it("does not disturb a load that settles normally (no lingering rejection after success)", async () => {
    const runtime = new RecordingQvacModelPort();
    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel.ensureModel()).resolves.toBe("fake-model");
    await expect(chatModel.cancelLoad()).resolves.toBeUndefined();
  });

  it("is a safe no-op when nothing is loading", async () => {
    const runtime = new RecordingQvacModelPort();
    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel.cancelLoad()).resolves.toBeUndefined();
  });

  it("rejects with a plain Error (no hook configured) when abandoning a hung load", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.hangLoad = true;

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    const pending = chatModel.ensureModel();
    await Promise.resolve();

    await chatModel.cancelLoad();

    await expect(pending).rejects.toBeInstanceOf(Error);
    await expect(pending).rejects.not.toHaveProperty("stage");
  });
});

describe("ChatQVAC.getDelegationInfo", () => {
  it("returns the runtime's delegation info once a delegated load has resolved", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service: runtime,
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
    const runtime = new RecordingQvacModelPort();

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel.getDelegationInfo()).resolves.toBeUndefined();
    expect(runtime.getLoadedModelInfoCalls).toEqual([]);
  });

  it("resolves undefined (best-effort) if the introspection query itself fails", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.delegationInfoResult = "throw";
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
    });

    await expect(chatModel.getDelegationInfo()).resolves.toBeUndefined();
  });
});

describe("ChatQVAC.getCachedDelegationInfo", () => {
  it("is undefined before getDelegationInfo() has ever resolved", () => {
    const runtime = new RecordingQvacModelPort();
    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    expect(chatModel.getCachedDelegationInfo()).toBeUndefined();
  });

  it("reflects the last getDelegationInfo() result synchronously", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };
    const chatModel = new ChatQVAC({
      service: runtime,
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
    const runtime = new RecordingQvacModelPort();
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
      isRetryableProviderError: (err) => err instanceof TestProviderUnreachableError,
    });
    // Simulates the state right after a successful *initial* delegated
    // preload, before the provider died - matches what a host application's
    // preload step would have cached via getDelegationInfo() at startup.
    runtime.delegationInfoResult = { isDelegated: true, providerPublicKey: "pk-abc" };
    await chatModel.getDelegationInfo();

    // Once recovery has happened, the (now local) fallback model is what
    // a fresh introspection query reports - this stubs that answer.
    runtime.delegationInfoResult = { isDelegated: false };
    const result = await chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS);

    expect(result.generations[0]?.text).toBe("ok");
    expect(runtime.loadCallCount).toBe(2); // the initial load, plus one reload on recovery
    // Unloading the stale (still delegated) model BEFORE reloading is what
    // makes the reload a genuine local load rather than a same-modelId
    // no-op that would leave it delegated forever.
    expect(runtime.operations).toEqual(["load", "unload:fake-model", "load"]);
    expect(chatModel.getCachedDelegationInfo()).toEqual({ isDelegated: false });
  });

  it("does not retry (or reload) on a genuine completion failure", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.chatCompleteOutcomes = ["genuine-failure"];

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS)).rejects.toThrow(
      "the model crashed",
    );
    expect(runtime.loadCallCount).toBe(1); // no reload attempted
  });

  it("does not retry a provider-unreachable-shaped failure when no hooks are configured (default no-op behavior)", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.chatCompleteOutcomes = ["provider-unreachable"];

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
    });

    await expect(chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS)).rejects.toBeInstanceOf(
      TestProviderUnreachableError,
    );
    expect(runtime.loadCallCount).toBe(1); // no reload attempted - default isRetryableProviderError is () => false
  });

  it("surfaces the original error if recovery itself also fails to complete", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.chatCompleteOutcomes = ["provider-unreachable", "provider-unreachable"];
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
      isRetryableProviderError: (err) => err instanceof TestProviderUnreachableError,
    });

    // Only one retry is attempted - a second consecutive failure propagates.
    await expect(chatModel._generate([new HumanMessage("hi")], CALL_OPTIONS)).rejects.toBeTruthy();
    expect(runtime.loadCallCount).toBe(2);
  });
});

describe("ChatQVAC._streamResponseChunks delegation recovery", () => {
  it("recovers by reloading and retrying once when the provider dies before any token is streamed", async () => {
    const runtime = new RecordingQvacModelPort();
    runtime.chatCompleteOutcomes = ["provider-unreachable"];
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };

    const chatModel = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.com/model.gguf" },
      delegate,
      isRetryableProviderError: (err) => err instanceof TestProviderUnreachableError,
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
    const runtime = new RecordingQvacModelPort();
    runtime.chatCompleteOutcomes = ["genuine-failure"];

    const chatModel = new ChatQVAC({
      service: runtime,
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

const FAKE_SOURCE: QvacModelSource = {
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
    const runtime = new FakeQvacModelPort();
    const model = new ChatQVAC({ service: runtime, modelSource: FAKE_SOURCE });

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
    const runtime = new FakeQvacModelPort();
    const model = new ChatQVAC({ service: runtime, modelSource: FAKE_SOURCE });

    await model.invoke([new HumanMessage("hello")]);

    const history = runtime.lastChatRequest?.history ?? [];
    expect(history[0]?.images).toBeUndefined();
  });
});

describe("ChatQVAC per-call temperature/seed override", () => {
  it("uses the per-call temperature/seed override instead of the constructor default", async () => {
    const runtime = new FakeQvacModelPort();
    const model = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.test/model.gguf" },
      temperature: 0,
    });

    await model.invoke([new HumanMessage("hi")], { temperature: 0.9, seed: 123 });

    expect(runtime.lastChatRequest?.temperature).toBe(0.9);
    expect(runtime.lastChatRequest?.seed).toBe(123);
  });

  it("falls back to the constructor default temperature when no override is given", async () => {
    const runtime = new FakeQvacModelPort();
    const model = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.test/model.gguf" },
      temperature: 0.4,
    });

    await model.invoke([new HumanMessage("hi")]);

    expect(runtime.lastChatRequest?.temperature).toBe(0.4);
    expect(runtime.lastChatRequest?.seed).toBeUndefined();
  });
});

describe("ChatQVAC kvCacheEnabled", () => {
  it("threads the constructor's kvCacheEnabled into every chatComplete request", async () => {
    const runtime = new FakeQvacModelPort();
    const model = new ChatQVAC({
      service: runtime,
      modelSource: { kind: "url", url: "https://example.test/model.gguf" },
      kvCacheEnabled: false,
    });

    await model.invoke([new HumanMessage("hi")]);

    expect(runtime.lastChatRequest?.kvCacheEnabled).toBe(false);
  });

  it("leaves kvCacheEnabled undefined when not configured", async () => {
    const runtime = new FakeQvacModelPort();
    const model = new ChatQVAC({ service: runtime, modelSource: FAKE_SOURCE });

    await model.invoke([new HumanMessage("hi")]);

    expect(runtime.lastChatRequest?.kvCacheEnabled).toBeUndefined();
  });
});

describe("ChatQVAC.bindTools", () => {
  it("flattens a tool's primitive-typed properties into QvacChatTool", async () => {
    const runtime = new FakeQvacModelPort();
    const model = new ChatQVAC({ service: runtime, modelSource: FAKE_SOURCE });

    const lookupSkuTool = tool(() => "unused", {
      name: "lookup_sku",
      description: "Look up a SKU in the inventory",
      schema: z.object({
        sku: z.string().describe("The SKU to look up"),
        limit: z.number().optional(),
      }),
    });

    const bound = model.bindTools([lookupSkuTool]);

    await bound.invoke([new HumanMessage("hi")]);

    expect(runtime.lastChatRequest?.tools).toEqual([
      {
        type: "function",
        name: "lookup_sku",
        description: "Look up a SKU in the inventory",
        parameters: {
          type: "object",
          properties: {
            sku: { type: "string", description: "The SKU to look up", enum: undefined },
            limit: { type: "number", description: undefined, enum: undefined },
          },
          required: ["sku"],
        },
      },
    ]);
  });
});
