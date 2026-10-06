import { afterEach, describe, expect, it, vi } from "vitest";

const { startMock, embedManyMock, shutdownMock, isCrashedMock, resolveModelPathMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  embedManyMock: vi.fn(),
  shutdownMock: vi.fn(),
  isCrashedMock: vi.fn(() => false),
  resolveModelPathMock: vi.fn(() => "/cache/gemma.gguf"),
}));

vi.mock("./nativeEmbeddingClient.js", () => ({
  NativeEmbeddingClient: vi.fn().mockImplementation(function FakeNativeEmbeddingClient() {
    return {
      start: startMock,
      embedMany: embedManyMock,
      shutdown: shutdownMock,
      get isCrashed() {
        return isCrashedMock();
      },
    };
  }),
}));

vi.mock("./embeddingGemmaModel.js", () => ({
  resolveNativeEmbeddingModelPath: resolveModelPathMock,
  DEFAULT_NATIVE_EMBED_CONFIG: { device: "gpu" },
}));

const { NativeEmbeddingProvider } = await import("./nativeEmbeddingProvider.js");

const SOURCE = { kind: "registry" as const, registryPath: "meridian/gemma.gguf", registrySource: "hf" };

afterEach(() => {
  vi.clearAllMocks();
});

describe("NativeEmbeddingProvider.ensureLoaded", () => {
  it("resolves the model path once and starts the client with it", async () => {
    startMock.mockResolvedValue(undefined);
    const provider = new NativeEmbeddingProvider(SOURCE, 10);

    await provider.ensureLoaded();
    await provider.ensureLoaded();

    expect(resolveModelPathMock).toHaveBeenCalledTimes(1);
    expect(resolveModelPathMock).toHaveBeenCalledWith(SOURCE, 10);
    expect(startMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledWith("/cache/gemma.gguf", { device: "gpu" });
  });

  it("forgets a failed attempt so the next call retries", async () => {
    startMock.mockRejectedValueOnce(new Error("worker failed to start"));
    const provider = new NativeEmbeddingProvider(SOURCE, 10);

    await expect(provider.ensureLoaded()).rejects.toThrow("worker failed to start");

    startMock.mockResolvedValueOnce(undefined);
    await expect(provider.ensureLoaded()).resolves.toBeUndefined();
    expect(startMock).toHaveBeenCalledTimes(2);
  });
});

describe("NativeEmbeddingProvider.embed", () => {
  it("loads the model, embeds the text, and validates the result", async () => {
    startMock.mockResolvedValue(undefined);
    embedManyMock.mockResolvedValue([{ embedding: [0.1, 0.2, 0.3], stats: null }]);
    const provider = new NativeEmbeddingProvider(SOURCE, 10);

    await expect(provider.embed("How many in stock?")).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(embedManyMock).toHaveBeenCalledWith(["How many in stock?"]);
  });
});

describe("NativeEmbeddingProvider.embedBatch", () => {
  it("short-circuits to an empty array without loading the model", async () => {
    const provider = new NativeEmbeddingProvider(SOURCE, 10);

    await expect(provider.embedBatch([])).resolves.toEqual([]);
    expect(startMock).not.toHaveBeenCalled();
  });

  it("validates every returned embedding", async () => {
    startMock.mockResolvedValue(undefined);
    embedManyMock.mockResolvedValue([
      { embedding: [0.1, 0.2], stats: null },
      { embedding: [0.3, 0.4], stats: null },
    ]);
    const provider = new NativeEmbeddingProvider(SOURCE, 10);

    await expect(provider.embedBatch(["a", "b"])).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
  });

  it("throws when the worker returns a different number of vectors than texts sent", async () => {
    startMock.mockResolvedValue(undefined);
    embedManyMock.mockResolvedValue([{ embedding: [0.1, 0.2], stats: null }]);
    const provider = new NativeEmbeddingProvider(SOURCE, 10);

    await expect(provider.embedBatch(["a", "b"])).rejects.toThrow(/returned 1 vectors for 2 texts/);
  });
});

describe("NativeEmbeddingProvider.isCrashed", () => {
  it("passes through the underlying client's crashed state", () => {
    isCrashedMock.mockReturnValueOnce(true);
    const provider = new NativeEmbeddingProvider(SOURCE, 10);
    expect(provider.isCrashed).toBe(true);
  });
});

describe("NativeEmbeddingProvider.unload", () => {
  it("is a no-op if the worker was never started", async () => {
    const provider = new NativeEmbeddingProvider(SOURCE, 10);
    await provider.unload();
    expect(shutdownMock).not.toHaveBeenCalled();
  });

  it("shuts down the client once it has been loaded", async () => {
    startMock.mockResolvedValue(undefined);
    shutdownMock.mockResolvedValue(undefined);
    const provider = new NativeEmbeddingProvider(SOURCE, 10);
    await provider.ensureLoaded();

    await provider.unload();

    expect(shutdownMock).toHaveBeenCalled();
  });
});
