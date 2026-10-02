import { describe, expect, it, vi } from "vitest";

const { textToSpeechMock } = vi.hoisted(() => ({ textToSpeechMock: vi.fn() }));

// Only textToSpeech is overridden - the catalog constants models.config.ts reads stay real.
vi.mock("@qvac/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@qvac/sdk")>();
  return { ...actual, textToSpeech: textToSpeechMock };
});

const { QvacTtsAdapter } = await import("./qvacTtsAdapter.js");
const { SUPERTONIC_MAX_CHUNK_CHARS, SUPERTONIC_SAMPLE_RATE } = await import("../../config/models.config.js");

/** What textToSpeech() returns for `stream: true, sentenceStream: true`: the audio arrives only through `chunkUpdates` (`buffer` resolves to []). */
function sentenceStreamResult(chunkUpdates: AsyncGenerator<{ buffer: number[] }> | undefined) {
  return { chunkUpdates, bufferStream: (async function* () {})(), buffer: Promise.resolve([]), done: Promise.resolve(true) };
}

async function* chunksOf(pieces: number[][]) {
  for (const buffer of pieces) yield { buffer };
}

/** Reads back the int16 samples after pcmToWav's 44-byte header. */
function wavSamples(wav: Buffer): number[] {
  const samples: number[] = [];
  for (let offset = 44; offset < wav.length; offset += 2) samples.push(wav.readInt16LE(offset));
  return samples;
}

describe("QvacTtsAdapter.synthesize", () => {
  it("asks the SDK to split the text into chunks Supertonic can voice whole", async () => {
    textToSpeechMock.mockReturnValue(sentenceStreamResult(chunksOf([[1]])));
    await new QvacTtsAdapter().synthesize("model-1", "Some text.");
    expect(textToSpeechMock).toHaveBeenCalledWith({
      modelId: "model-1",
      text: "Some text.",
      inputType: "text",
      stream: true,
      sentenceStream: true,
      sentenceStreamMaxChunkScalars: SUPERTONIC_MAX_CHUNK_CHARS,
    });
  });

  it("joins every chunk's samples, in order, into one WAV", async () => {
    textToSpeechMock.mockReturnValue(sentenceStreamResult(chunksOf([[1, 2], [3], [4, 5]])));
    const result = await new QvacTtsAdapter().synthesize("model-1", "Long text.");
    expect(wavSamples(result.audio)).toEqual([1, 2, 3, 4, 5]);
    expect(result.sampleRate).toBe(SUPERTONIC_SAMPLE_RATE);
  });

  it("rejects when synthesis fails partway through, instead of returning partial audio", async () => {
    async function* failing() {
      yield { buffer: [1] };
      throw new Error("engine failed");
    }
    textToSpeechMock.mockReturnValue(sentenceStreamResult(failing()));
    await expect(new QvacTtsAdapter().synthesize("model-1", "x")).rejects.toThrow("engine failed");
  });

  it("rejects when the SDK returns no chunkUpdates, instead of returning silent audio", async () => {
    textToSpeechMock.mockReturnValue(sentenceStreamResult(undefined));
    await expect(new QvacTtsAdapter().synthesize("model-1", "x")).rejects.toThrow("chunkUpdates");
  });
});
