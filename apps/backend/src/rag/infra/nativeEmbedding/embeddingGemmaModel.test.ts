import { describe, expect, it, vi } from "vitest";

const { existsSyncMock, readdirSyncMock, statSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  readdirSyncMock: vi.fn(),
  statSyncMock: vi.fn(),
}));

/** This module resolves real model weights on disk; mocking node:fs keeps the test from ever touching the repo's actual (multi-GB) .qvac-cache directory. */
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: existsSyncMock, readdirSync: readdirSyncMock, statSync: statSyncMock };
});

const { resolveEmbeddingGemmaModelPath, resolveNativeEmbeddingModelPath } = await import("./embeddingGemmaModel.js");
const { EMBEDDINGGEMMA_300M_Q4_0 } = await import("@qvac/sdk");

const REGISTRY_SOURCE = { kind: "registry" as const, registryPath: "meridian/gemma.gguf", registrySource: "hf" };

describe("resolveNativeEmbeddingModelPath", () => {
  it("throws when the cache directory does not exist", () => {
    existsSyncMock.mockReturnValue(false);

    expect(() => resolveNativeEmbeddingModelPath(REGISTRY_SOURCE, 10)).toThrow(/QVAC cache directory not found/);
  });

  it("throws when no cached entry matches the source's filename", () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(["unrelated-file.gguf"]);

    expect(() => resolveNativeEmbeddingModelPath(REGISTRY_SOURCE, 10)).toThrow(/Could not find a cached "gemma.gguf"/);
  });

  it("throws when the matched file's size does not match expectedSize", () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(["abc123_gemma.gguf"]);
    statSyncMock.mockReturnValue({ size: 5 });

    expect(() => resolveNativeEmbeddingModelPath(REGISTRY_SOURCE, 999)).toThrow(/is 5 bytes, expected 999/);
  });

  it("matches a hash-prefixed cache entry by filename suffix, for a registry source", () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(["abc123_gemma.gguf"]);
    statSyncMock.mockReturnValue({ size: 10 });

    expect(resolveNativeEmbeddingModelPath(REGISTRY_SOURCE, 10)).toMatch(/abc123_gemma\.gguf$/);
  });

  it("matches a cache entry stored under its exact filename, with no hash prefix", () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(["gemma.gguf"]);
    statSyncMock.mockReturnValue({ size: 10 });

    expect(resolveNativeEmbeddingModelPath(REGISTRY_SOURCE, 10)).toMatch(/gemma\.gguf$/);
  });

  it("resolves a url source by the basename of its path", () => {
    existsSyncMock.mockReturnValue(true);
    readdirSyncMock.mockReturnValue(["abc123_gemma.gguf"]);
    statSyncMock.mockReturnValue({ size: 10 });

    expect(resolveNativeEmbeddingModelPath({ kind: "url", url: "https://example.com/models/gemma.gguf" }, 10)).toMatch(
      /abc123_gemma\.gguf$/,
    );
  });

  it("cannot resolve a cache filename for a rawSrc model source", () => {
    existsSyncMock.mockReturnValue(true);

    expect(() => resolveNativeEmbeddingModelPath({ kind: "rawSrc", src: "hf://whatever.gguf" }, 10)).toThrow(
      /cannot resolve a cache filename for ModelSource kind="rawSrc"/,
    );
  });
});

describe("resolveEmbeddingGemmaModelPath", () => {
  it("resolves EmbeddingGemma 300M Q4_0 specifically", () => {
    existsSyncMock.mockReturnValue(true);
    const filename = EMBEDDINGGEMMA_300M_Q4_0.registryPath.split("/").pop();
    readdirSyncMock.mockReturnValue([filename]);
    statSyncMock.mockReturnValue({ size: EMBEDDINGGEMMA_300M_Q4_0.expectedSize });

    expect(resolveEmbeddingGemmaModelPath()).toMatch(new RegExp(`${filename}$`));
  });
});
