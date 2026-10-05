import { beforeEach, describe, expect, it, vi } from "vitest";

const { textToSpeechMock } = vi.hoisted(() => ({ textToSpeechMock: vi.fn() }));

// Only textToSpeech is overridden - the catalog constants models.config.ts reads stay real.
vi.mock("@qvac/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@qvac/sdk")>();
  return { ...actual, textToSpeech: textToSpeechMock };
});

const { QvacTtsAdapter, toJobs } = await import("./qvacTtsAdapter.js");
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
  beforeEach(() => {
    textToSpeechMock.mockReset();
  });

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

describe("QvacTtsAdapter.synthesize - engine jobs", () => {
  beforeEach(() => {
    textToSpeechMock.mockReset();
    // A fresh stream per call: each job reads its own chunks.
    textToSpeechMock.mockImplementation(({ text }: { text: string }) => sentenceStreamResult(chunksOf([[text.length]])));
  });

  it("sends each job to the engine in order and joins their samples into one WAV", async () => {
    const long = `${"a".repeat(150)}.`;
    const result = await new QvacTtsAdapter().synthesize("model-1", `${long} ${long}`);

    expect(textToSpeechMock.mock.calls.map(([params]) => (params as { text: string }).text)).toEqual([long, long]);
    expect(wavSamples(result.audio)).toEqual([long.length, long.length]);
  });

  it("starts no further job once the signal aborts - the job already in the engine still finishes", async () => {
    const controller = new AbortController();
    textToSpeechMock.mockImplementation(({ text }: { text: string }) => {
      controller.abort(); // the turn is stopped while this job runs
      return sentenceStreamResult(chunksOf([[text.length]]));
    });
    const long = `${"a".repeat(150)}.`;

    await expect(
      new QvacTtsAdapter().synthesize("model-1", `${long} ${long}`, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(textToSpeechMock).toHaveBeenCalledTimes(1);
  });

  it("calls the engine not even once when the signal is already aborted", async () => {
    await expect(
      new QvacTtsAdapter().synthesize("model-1", "Hi.", { signal: AbortSignal.abort() }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(textToSpeechMock).not.toHaveBeenCalled();
  });
});

describe("toJobs", () => {
  it("packs whole sentences into jobs of at most maxChars", () => {
    expect(toJobs("One. Two. Three is longer.", 10)).toEqual(["One. Two.", "Three is longer."]);
  });

  it("keeps a sentence longer than maxChars as a job of its own", () => {
    expect(toJobs("A very long sentence here. Ok.", 10)).toEqual(["A very long sentence here.", "Ok."]);
  });

  it("only splits after a sentence end, never inside a number", () => {
    expect(toJobs("Up 3.1 points. Done.", 200)).toEqual(["Up 3.1 points. Done."]);
  });
});
