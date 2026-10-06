import { describe, expect, it, vi } from "vitest";

const { embedMock } = vi.hoisted(() => ({ embedMock: vi.fn() }));

vi.mock("@qvac/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@qvac/sdk")>();
  return { ...actual, embed: embedMock };
});

const { QvacEmbeddingAdapter } = await import("./qvacEmbeddingAdapter.js");

describe("QvacEmbeddingAdapter", () => {
  it("embedOne returns the single embedding vector", async () => {
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3] });

    const adapter = new QvacEmbeddingAdapter();
    await expect(adapter.embedOne("model-1", "hello")).resolves.toEqual([0.1, 0.2, 0.3]);
    expect(embedMock).toHaveBeenCalledWith({ modelId: "model-1", text: "hello" });
  });

  it("embedMany forwards the text array and returns a vector per text", async () => {
    embedMock.mockResolvedValue({
      embedding: [
        [0.1, 0.2],
        [0.3, 0.4],
      ],
    });

    const adapter = new QvacEmbeddingAdapter();
    await expect(adapter.embedMany("model-1", ["a", "b"])).resolves.toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(embedMock).toHaveBeenCalledWith({ modelId: "model-1", text: ["a", "b"] });
  });
});
