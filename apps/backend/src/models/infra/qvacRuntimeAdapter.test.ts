import { describe, expect, it, vi } from "vitest";
import { DelegatedProviderUnreachableError, OperationCancelledError } from "../domain/errors.js";

const {
  loadModelMock,
  getLoadedModelInfoMock,
  completionMock,
  downloadAssetMock,
  deleteCacheMock,
  heartbeatMock,
  modelRegistrySearchMock,
  modelRegistryListMock,
  unloadModelMock,
  closeMock,
  cancelMock,
} = vi.hoisted(() => ({
  loadModelMock: vi.fn(),
  getLoadedModelInfoMock: vi.fn(),
  completionMock: vi.fn(),
  downloadAssetMock: vi.fn(),
  deleteCacheMock: vi.fn(),
  heartbeatMock: vi.fn(),
  modelRegistrySearchMock: vi.fn(),
  modelRegistryListMock: vi.fn(),
  unloadModelMock: vi.fn(),
  closeMock: vi.fn(),
  cancelMock: vi.fn(),
}));

/**
 * A cancelled `loadModel()` never round-trips as `InferenceCancelledError` (per `@qvac/sdk`'s own `rpc-error.ts`, that class is only reconstructed from the completion path's partial state) - it crosses as a generic error carrying the same `INFERENCE_CANCELLED` code.
 * Only `loadModel` is mocked here; everything else (incl. `SDK_SERVER_ERROR_CODES`) stays real.
 */
vi.mock("@qvac/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@qvac/sdk")>();
  return {
    ...actual,
    loadModel: loadModelMock,
    getLoadedModelInfo: getLoadedModelInfoMock,
    completion: completionMock,
    downloadAsset: downloadAssetMock,
    deleteCache: deleteCacheMock,
    heartbeat: heartbeatMock,
    modelRegistrySearch: modelRegistrySearchMock,
    modelRegistryList: modelRegistryListMock,
    unloadModel: unloadModelMock,
    close: closeMock,
    cancel: cancelMock,
  };
});

const { QvacRuntimeAdapter } = await import("./qvacRuntimeAdapter.js");
const { SDK_SERVER_ERROR_CODES } = await import("@qvac/sdk");
const { REPEAT_PENALTY, MAX_REPLY_TOKENS } = await import("./qvacRuntimeAdapter.const.js");

describe("QvacRuntimeAdapter.load", () => {
  it("translates a cancelled load's generic RPC error into OperationCancelledError, not a genuine failure", async () => {
    const genericRpcError = Object.assign(
      new Error('Inference request "req-1" was cancelled before it could complete'),
      { code: SDK_SERVER_ERROR_CODES.INFERENCE_CANCELLED, name: "INFERENCE_CANCELLED" },
    );
    loadModelMock.mockReturnValue(
      Object.assign(Promise.reject(genericRpcError), { requestId: "req-1" }),
    );

    const adapter = new QvacRuntimeAdapter();
    const pending = adapter.load({ kind: "url", url: "https://example.com/model.gguf" });

    await expect(pending).rejects.toBeInstanceOf(OperationCancelledError);
  });

  it("forwards delegate options to the SDK's loadModel() call unchanged", () => {
    loadModelMock.mockReturnValue(
      Object.assign(Promise.resolve("model-1"), { requestId: "req-2" }),
    );

    const adapter = new QvacRuntimeAdapter();
    const delegate = { providerPublicKey: "pk-abc", fallbackToLocal: true };
    adapter.load({ kind: "url", url: "https://example.com/model.gguf" }, { delegate });

    expect(loadModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ delegate }),
    );
  });
});

describe("QvacRuntimeAdapter registry lookups", () => {
  const sdkEntry = {
    name: "Meridian 7B",
    registryPath: "meridian/7b",
    registrySource: "hf",
    engine: "llamacpp",
    addon: "none",
    quantization: "q4",
    params: "7b",
    expectedSize: 4_200_000,
  };
  const summary = {
    name: "Meridian 7B",
    registryPath: "meridian/7b",
    registrySource: "hf",
    engine: "llamacpp",
    addon: "none",
    quantization: "q4",
    params: "7b",
    expectedSizeBytes: 4_200_000,
  };

  it("searchRegistry maps the SDK's expectedSize to expectedSizeBytes", async () => {
    modelRegistrySearchMock.mockResolvedValue([sdkEntry]);

    const adapter = new QvacRuntimeAdapter();
    await expect(adapter.searchRegistry({ filter: "meridian" })).resolves.toEqual([summary]);
  });

  it("listRegistry maps every entry the same way", async () => {
    modelRegistryListMock.mockResolvedValue([sdkEntry]);

    const adapter = new QvacRuntimeAdapter();
    await expect(adapter.listRegistry()).resolves.toEqual([summary]);
  });
});

describe("QvacRuntimeAdapter.load progress and registry sources", () => {
  it("maps the SDK's progress shape and reconstructs a registry:// source", () => {
    loadModelMock.mockReturnValue(Object.assign(Promise.resolve("model-1"), { requestId: "req-8" }));
    const onProgress = vi.fn();

    const adapter = new QvacRuntimeAdapter();
    adapter.load({ kind: "registry", registrySource: "hf", registryPath: "meridian/7b" }, undefined, onProgress);

    expect(loadModelMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelSrc: "registry://hf/meridian/7b" }),
    );
    const { onProgress: sdkOnProgress } = loadModelMock.mock.calls[0][0];
    sdkOnProgress({ percentage: 50, downloaded: 512, total: 1024 });
    expect(onProgress).toHaveBeenCalledWith({ percentage: 50, downloadedBytes: 512, totalBytes: 1024 });
  });
});

describe("QvacRuntimeAdapter.infer", () => {
  it("resolves the completion's text", async () => {
    completionMock.mockReturnValue({
      requestId: "req-9",
      final: Promise.resolve({ contentText: "22 units available", toolCalls: [], thinkingText: "" }),
    });

    const adapter = new QvacRuntimeAdapter();
    await expect(adapter.infer("model-1", "How many in stock?")).resolves.toEqual({ text: "22 units available" });
    expect(completionMock).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: "model-1", stream: false, kvCache: true }),
    );
  });

  it("translates a cancelled inference the same way as a cancelled load", async () => {
    const cancelled = Object.assign(new Error("cancelled"), { code: SDK_SERVER_ERROR_CODES.INFERENCE_CANCELLED });
    completionMock.mockReturnValue({ requestId: "req-10", final: Promise.reject(cancelled) });

    const adapter = new QvacRuntimeAdapter();
    await expect(adapter.infer("model-1", "hi")).rejects.toBeInstanceOf(OperationCancelledError);
  });
});

describe("QvacRuntimeAdapter.chatComplete streaming", () => {
  it("forwards each contentDelta token to onToken as it streams in", async () => {
    async function* events() {
      yield { type: "contentDelta", text: "Enter" };
      yield { type: "contentDelta", text: "prise" };
      yield { type: "toolCallDelta" };
    }
    completionMock.mockReturnValue({
      requestId: "req-11",
      events: events(),
      final: Promise.resolve({ contentText: "Enterprise", toolCalls: [], thinkingText: "" }),
    });

    const adapter = new QvacRuntimeAdapter();
    const onToken = vi.fn();
    await adapter.chatComplete("model-1", { history: [{ role: "user", content: "hi" }] }, onToken);
    await new Promise((resolve) => setImmediate(resolve));

    expect(onToken.mock.calls).toEqual([["Enter"], ["prise"]]);
  });

  it("swallows a streaming error - the failure still surfaces through the final completion promise", async () => {
    async function* events(): AsyncGenerator<{ type: string; text?: string }> {
      yield { type: "contentDelta", text: "partial" };
      throw new Error("stream disconnected");
    }
    completionMock.mockReturnValue({
      requestId: "req-12",
      events: events(),
      final: Promise.reject(new Error("stream disconnected")),
    });

    const adapter = new QvacRuntimeAdapter();
    const onToken = vi.fn();
    const pending = adapter.chatComplete("model-1", { history: [{ role: "user", content: "hi" }] }, onToken);

    await expect(pending).rejects.toThrow("stream disconnected");
    expect(onToken).toHaveBeenCalledWith("partial");
  });
});

describe("QvacRuntimeAdapter thin wrappers", () => {
  it("unload forwards the modelId without clearing storage", async () => {
    unloadModelMock.mockResolvedValue(undefined);
    await new QvacRuntimeAdapter().unload("model-1");
    expect(unloadModelMock).toHaveBeenCalledWith({ modelId: "model-1", clearStorage: false });
  });

  it("close shuts down the SDK", async () => {
    closeMock.mockResolvedValue(undefined);
    await new QvacRuntimeAdapter().close();
    expect(closeMock).toHaveBeenCalled();
  });

  it("cancel forwards the requestId", async () => {
    cancelMock.mockResolvedValue(undefined);
    await new QvacRuntimeAdapter().cancel("req-1");
    expect(cancelMock).toHaveBeenCalledWith({ requestId: "req-1" });
  });

  it("cancelCompletions targets every completion for a model, not a single request", async () => {
    cancelMock.mockResolvedValue(undefined);
    await new QvacRuntimeAdapter().cancelCompletions("model-1");
    expect(cancelMock).toHaveBeenCalledWith({ modelId: "model-1", kind: "completion" });
  });
});

describe("QvacRuntimeAdapter.getLoadedModelInfo", () => {
  it("reports a delegated model as delegated, with the provider's public key", async () => {
    getLoadedModelInfoMock.mockResolvedValue({
      modelId: "model-1",
      isDelegated: true,
      handlers: [],
      providerInfo: { providerPublicKey: "pk-abc" },
    });

    const adapter = new QvacRuntimeAdapter();
    await expect(adapter.getLoadedModelInfo("model-1")).resolves.toEqual({
      isDelegated: true,
      providerPublicKey: "pk-abc",
    });
  });

  it("reports a local model as not delegated, with no provider public key", async () => {
    getLoadedModelInfoMock.mockResolvedValue({
      modelId: "model-1",
      isDelegated: false,
      modelType: "llamacpp-completion",
      handlers: ["completion"],
      loadedAt: new Date(),
    });

    const adapter = new QvacRuntimeAdapter();
    await expect(adapter.getLoadedModelInfo("model-1")).resolves.toEqual({
      isDelegated: false,
      providerPublicKey: undefined,
    });
  });
});

describe("QvacRuntimeAdapter.deleteCache", () => {
  it("deletes the SDK's KV cache for the given key, across every model", async () => {
    deleteCacheMock.mockResolvedValue({ success: true });

    const adapter = new QvacRuntimeAdapter();
    await adapter.deleteCache("session-1");

    expect(deleteCacheMock).toHaveBeenCalledWith({ kvCacheKey: "session-1" });
  });
});

describe("QvacRuntimeAdapter.chatComplete attachments", () => {
  it("writes an attached image to a temp file, passes its path to the SDK, and cleans it up afterwards", async () => {
    const { existsSync } = await import("node:fs");
    let capturedPath = "";
    let existedWhenSdkSawIt = false;
    completionMock.mockImplementation(({ history }) => {
      capturedPath = history[0].attachments[0].path;
      existedWhenSdkSawIt = existsSync(capturedPath);
      return {
        requestId: "req-img",
        events: (async function* () {})(),
        final: Promise.resolve({ contentText: "a dented housing", toolCalls: [], thinkingText: "" }),
      };
    });

    const adapter = new QvacRuntimeAdapter();
    await adapter.chatComplete("model-1", {
      history: [
        {
          role: "user",
          content: "what's wrong with this part?",
          images: [{ mimeType: "image/png", data: new Uint8Array([1, 2, 3]) }],
        },
      ],
    });

    expect(capturedPath).toMatch(/qvac-vlm-.*\.png$/);
    expect(existedWhenSdkSawIt).toBe(true);
    expect(existsSync(capturedPath)).toBe(false);
  });
});

describe("QvacRuntimeAdapter.chatComplete", () => {
  it("translates a delegated provider's unreachable-connection failure into DelegatedProviderUnreachableError", async () => {
    const providerUnreachableError = Object.assign(
      new Error("Error communicating with provider: connection refused"),
      { code: SDK_SERVER_ERROR_CODES.COMPLETION_FAILED, name: "COMPLETION_FAILED" },
    );
    completionMock.mockReturnValue({
      requestId: "req-3",
      events: (async function* () {})(),
      final: Promise.reject(providerUnreachableError),
    });

    const adapter = new QvacRuntimeAdapter();
    const pending = adapter.chatComplete("model-1", { history: [{ role: "user", content: "hi" }] });

    await expect(pending).rejects.toBeInstanceOf(DelegatedProviderUnreachableError);
  });

  it("does not mistake an ordinary completion failure for a provider-unreachable one", async () => {
    const genuineFailure = Object.assign(
      new Error("model produced invalid output"),
      { code: SDK_SERVER_ERROR_CODES.COMPLETION_FAILED, name: "COMPLETION_FAILED" },
    );
    completionMock.mockReturnValue({
      requestId: "req-4",
      events: (async function* () {})(),
      final: Promise.reject(genuineFailure),
    });

    const adapter = new QvacRuntimeAdapter();
    const pending = adapter.chatComplete("model-1", { history: [{ role: "user", content: "hi" }] });

    await expect(pending).rejects.not.toBeInstanceOf(DelegatedProviderUnreachableError);
  });

  it("passes seed through generationParams alongside temperature", () => {
    completionMock.mockReturnValue({
      requestId: "req-5",
      events: (async function* () {})(),
      final: Promise.resolve({ contentText: "hi", toolCalls: [], thinkingText: "" }),
    });

    const adapter = new QvacRuntimeAdapter();
    adapter.chatComplete("model-1", {
      history: [{ role: "user", content: "hi" }],
      temperature: 0.3,
      seed: 7,
    });

    expect(completionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationParams: {
          temp: 0.3,
          seed: 7,
          repeat_penalty: REPEAT_PENALTY,
          predict: MAX_REPLY_TOKENS,
        },
      }),
    );
  });

  it("always guards against runaway repetition, even without a temperature or seed", () => {
    completionMock.mockReturnValue({
      requestId: "req-5b",
      events: (async function* () {})(),
      final: Promise.resolve({ contentText: "hi", toolCalls: [], thinkingText: "" }),
    });

    const adapter = new QvacRuntimeAdapter();
    adapter.chatComplete("model-1", { history: [{ role: "user", content: "hi" }] });

    expect(completionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        generationParams: { repeat_penalty: REPEAT_PENALTY, predict: MAX_REPLY_TOKENS },
      }),
    );
  });

  it("maps each SDK tool call to its id, name, and arguments", async () => {
    completionMock.mockReturnValue({
      requestId: "req-5c",
      events: (async function* () {})(),
      final: Promise.resolve({
        contentText: "",
        toolCalls: [{ id: "call_1", name: "lookup_stock", arguments: { sku: "SD-X4-001" } }],
        thinkingText: "",
      }),
    });

    const adapter = new QvacRuntimeAdapter();
    const result = await adapter.chatComplete("model-1", { history: [{ role: "user", content: "stock?" }] });

    expect(result.toolCalls).toEqual([{ id: "call_1", name: "lookup_stock", arguments: { sku: "SD-X4-001" } }]);
  });

  it("disables the KV cache outright when kvCacheEnabled is false, regardless of sessionId", () => {
    completionMock.mockReturnValue({
      requestId: "req-6",
      events: (async function* () {})(),
      final: Promise.resolve({ contentText: "hi", toolCalls: [], thinkingText: "" }),
    });

    const adapter = new QvacRuntimeAdapter();
    adapter.chatComplete("model-1", {
      history: [{ role: "user", content: "hi" }],
      sessionId: "session-1",
      kvCacheEnabled: false,
    });

    expect(completionMock).toHaveBeenCalledWith(
      expect.objectContaining({ kvCache: false }),
    );
  });

  it("falls back to sessionId (or true) when kvCacheEnabled is omitted", () => {
    completionMock.mockReturnValue({
      requestId: "req-7",
      events: (async function* () {})(),
      final: Promise.resolve({ contentText: "hi", toolCalls: [], thinkingText: "" }),
    });

    const adapter = new QvacRuntimeAdapter();
    adapter.chatComplete("model-1", {
      history: [{ role: "user", content: "hi" }],
      sessionId: "session-1",
    });

    expect(completionMock).toHaveBeenCalledWith(
      expect.objectContaining({ kvCache: "session-1" }),
    );
  });
});

describe("QvacRuntimeAdapter.provision", () => {
  it("provisions a raw catalog src string directly, unwrapped", async () => {
    downloadAssetMock.mockResolvedValue(undefined);

    const adapter = new QvacRuntimeAdapter();
    await adapter.provision({ kind: "rawSrc", src: "hf://some/projection-model.gguf" });
    expect(downloadAssetMock).toHaveBeenCalledWith(
      expect.objectContaining({ assetSrc: "hf://some/projection-model.gguf" }),
    );
  });
});

describe("QvacRuntimeAdapter.heartbeat", () => {
  it("sends the SDK a heartbeat addressed to the provider with the given timeout", async () => {
    heartbeatMock.mockResolvedValue({ type: "heartbeat", number: 1 });

    const adapter = new QvacRuntimeAdapter();
    await adapter.heartbeat({ providerPublicKey: "pk-abc", timeout: 3000 });

    expect(heartbeatMock).toHaveBeenCalledWith({
      delegate: { providerPublicKey: "pk-abc", timeout: 3000 },
    });
  });

  it("propagates the SDK's failure when the provider is unreachable", async () => {
    heartbeatMock.mockRejectedValue(new Error("provider offline"));

    const adapter = new QvacRuntimeAdapter();

    await expect(adapter.heartbeat({ providerPublicKey: "pk-abc", timeout: 3000 })).rejects.toThrow(
      "provider offline",
    );
  });
});
