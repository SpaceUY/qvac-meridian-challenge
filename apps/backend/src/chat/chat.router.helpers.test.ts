import { describe, expect, it } from "vitest";
import {
  parseMessages,
  parseHistory,
  parseAudioBase64,
  parseGenerationOptions,
  describeParseError,
  createEnvelope,
  wantsStream,
  toCompletionResponse,
  toRoleChunk,
  toTextChunk,
  toCitationsChunk,
  toToolsChunk,
  toDoneChunk,
  toContextChunk,
  toVoiceDoneChunk,
} from "./chat.router.helpers.js";
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE } from "./chat.router.const.js";

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);

function dataUrl(mimeType: string, bytes: Buffer): string {
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function imagePart(mimeType: string, bytes: Buffer) {
  return { type: "image_url", image_url: { url: dataUrl(mimeType, bytes) } };
}

describe("parseMessages", () => {
  it("parses user/assistant entries and drops system", () => {
    const result = parseMessages({
      messages: [
        { role: "system", content: "ignored" },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    });
    expect(result).toEqual([
      { role: "user", message: "hi" },
      { role: "assistant", message: "hello" },
    ]);
  });

  it("returns undefined for an empty messages array", () => {
    expect(parseMessages({ messages: [] })).toBeUndefined();
  });

  it("returns undefined when messages is missing or malformed", () => {
    expect(parseMessages({})).toBeUndefined();
    expect(parseMessages({ messages: [{ role: "user" }] })).toBeUndefined();
  });
});

describe("parseMessages — images", () => {
  it("parses a text+image content array into message + images", () => {
    const result = parseMessages({
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "what's wrong with this?" }, imagePart("image/jpeg", JPEG_BYTES)],
        },
      ],
    });

    expect(result).toEqual([
      {
        role: "user",
        message: "what's wrong with this?",
        images: [{ mimeType: "image/jpeg", data: JPEG_BYTES }],
      },
    ]);
  });

  it("accepts an image-only message (no text part) and a valid PNG", () => {
    const result = parseMessages({
      messages: [{ role: "user", content: [imagePart("image/png", PNG_BYTES)] }],
    });

    expect(result).toEqual([
      { role: "user", message: "", images: [{ mimeType: "image/png", data: PNG_BYTES }] },
    ]);
  });

  it("rejects an image whose real (magic-byte) format is WebP, regardless of the declared MIME type", () => {
    const result = parseMessages({
      messages: [{ role: "user", content: [imagePart("image/png", WEBP_BYTES)] }],
    });

    expect(result).toBeUndefined();
  });

  it("rejects bytes that don't match any recognized image signature", () => {
    const result = parseMessages({
      messages: [{ role: "user", content: [imagePart("image/jpeg", Buffer.from([0x00, 0x01, 0x02]))] }],
    });

    expect(result).toBeUndefined();
  });

  it("rejects image_url parts on a non-user role", () => {
    const result = parseMessages({
      messages: [{ role: "assistant", content: [imagePart("image/jpeg", JPEG_BYTES)] }],
    });

    expect(result).toBeUndefined();
  });

  it("rejects an image over MAX_IMAGE_BYTES", () => {
    const oversized = Buffer.concat([JPEG_BYTES, Buffer.alloc(MAX_IMAGE_BYTES)]);
    const result = parseMessages({
      messages: [{ role: "user", content: [imagePart("image/jpeg", oversized)] }],
    });

    expect(result).toBeUndefined();
  });

  it("rejects more than MAX_IMAGES_PER_MESSAGE images", () => {
    const parts = Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () => imagePart("image/jpeg", JPEG_BYTES));
    const result = parseMessages({ messages: [{ role: "user", content: parts }] });

    expect(result).toBeUndefined();
  });

  // MAX_IMAGES_PER_MESSAGE is temporarily 1 (see chat.router.const.ts - a
  // 2-image message crashes the QVAC worker), which makes this scenario
  // unreachable through parseMessages: 2 images now fail the count check
  // before ever reaching the total-bytes one. Re-enable once the count
  // limit goes back to 2+.
  it.skip("rejects when individually-valid images exceed MAX_TOTAL_IMAGE_BYTES together", () => {
    // 7MB each: under MAX_IMAGE_BYTES (8MB) individually, but two of them
    // (14MB) exceed MAX_TOTAL_IMAGE_BYTES (12MB).
    const sevenMb = Buffer.concat([JPEG_BYTES, Buffer.alloc(7 * 1024 * 1024 - JPEG_BYTES.length)]);
    const result = parseMessages({
      messages: [
        { role: "user", content: [imagePart("image/jpeg", sevenMb), imagePart("image/jpeg", sevenMb)] },
      ],
    });

    expect(result).toBeUndefined();
  });

  it("still accepts a plain string content (unchanged behavior)", () => {
    const result = parseMessages({ messages: [{ role: "user", content: "hi" }] });
    expect(result).toEqual([{ role: "user", message: "hi" }]);
  });
});

describe("describeParseError", () => {
  it("names WebP specifically as an unsupported format, regardless of the declared MIME type", () => {
    const reason = describeParseError({
      messages: [{ role: "user", content: [imagePart("image/png", WEBP_BYTES)] }],
    });
    expect(reason).toBe("Only JPEG or PNG images are supported");
  });

  it("names the per-image size limit", () => {
    const oversized = Buffer.concat([JPEG_BYTES, Buffer.alloc(MAX_IMAGE_BYTES)]);
    const reason = describeParseError({
      messages: [{ role: "user", content: [imagePart("image/jpeg", oversized)] }],
    });
    expect(reason).toBe(`Image is too large (max ${MAX_IMAGE_BYTES / (1024 * 1024)}MB)`);
  });

  it("names the per-message image count limit", () => {
    const parts = Array.from({ length: MAX_IMAGES_PER_MESSAGE + 1 }, () => imagePart("image/jpeg", JPEG_BYTES));
    const reason = describeParseError({ messages: [{ role: "user", content: parts }] });
    expect(reason).toBe(`You can attach up to ${MAX_IMAGES_PER_MESSAGE} images`);
  });

  // Same reason as the skipped test above - unreachable while
  // MAX_IMAGES_PER_MESSAGE is 1.
  it.skip("names the combined size limit", () => {
    const sevenMb = Buffer.concat([JPEG_BYTES, Buffer.alloc(7 * 1024 * 1024 - JPEG_BYTES.length)]);
    const reason = describeParseError({
      messages: [
        { role: "user", content: [imagePart("image/jpeg", sevenMb), imagePart("image/jpeg", sevenMb)] },
      ],
    });
    expect(reason).toBe("These images are too large together");
  });

  it("names the role restriction on image_url parts", () => {
    const reason = describeParseError({
      messages: [{ role: "assistant", content: [imagePart("image/jpeg", JPEG_BYTES)] }],
    });
    expect(reason).toBe("Images can only be attached to your own messages");
  });

  it("falls back to the generic reason for a structurally malformed body", () => {
    expect(describeParseError({})).toBe("invalid messages");
    expect(describeParseError({ messages: [{ role: "user" }] })).toBe("invalid messages");
  });
});

describe("parseHistory", () => {
  it("accepts an empty messages array (a voice turn with no prior history)", () => {
    expect(parseHistory({ messages: [] })).toEqual([]);
  });

  it("parses user/assistant entries and drops system, same as parseMessages", () => {
    const result = parseHistory({
      messages: [
        { role: "system", content: "ignored" },
        { role: "user", content: "hi" },
      ],
    });
    expect(result).toEqual([{ role: "user", message: "hi" }]);
  });

  it("returns undefined when messages is missing or malformed", () => {
    expect(parseHistory({})).toBeUndefined();
    expect(parseHistory({ messages: [{ role: "user" }] })).toBeUndefined();
  });
});

describe("parseGenerationOptions", () => {
  it("extracts temperature and seed when present", () => {
    expect(parseGenerationOptions({ temperature: 0.2, seed: 42 })).toEqual({
      temperature: 0.2,
      seed: 42,
    });
  });

  it("omits fields that are absent or the wrong type", () => {
    expect(parseGenerationOptions({})).toEqual({});
    expect(parseGenerationOptions({ temperature: "hot", seed: null })).toEqual({});
  });

  it("omits temperature outside OpenAI's [0, 2] range, and non-finite values", () => {
    expect(parseGenerationOptions({ temperature: -0.1 })).toEqual({});
    expect(parseGenerationOptions({ temperature: 2.1 })).toEqual({});
    expect(parseGenerationOptions({ temperature: NaN })).toEqual({});
    expect(parseGenerationOptions({ temperature: Infinity })).toEqual({});
  });

  it("omits a non-integer or non-finite seed", () => {
    expect(parseGenerationOptions({ seed: 1.5 })).toEqual({});
    expect(parseGenerationOptions({ seed: NaN })).toEqual({});
    expect(parseGenerationOptions({ seed: Number.MAX_SAFE_INTEGER + 1 })).toEqual({});
  });
});

describe("parseAudioBase64", () => {
  it("decodes a base64 string into a Buffer", () => {
    const audio = parseAudioBase64({ audioBase64: Buffer.from("fake-wav-bytes").toString("base64") });
    expect(audio).toEqual(Buffer.from("fake-wav-bytes"));
  });

  it("returns undefined when audioBase64 is missing, empty, or not a string", () => {
    expect(parseAudioBase64({})).toBeUndefined();
    expect(parseAudioBase64({ audioBase64: "" })).toBeUndefined();
    expect(parseAudioBase64({ audioBase64: 123 })).toBeUndefined();
  });
});

const ENVELOPE = { id: "chatcmpl-test", created: 1790000000, model: "meridian-assistant" };
const CITATIONS = [{ file: "reports/q2-2026-sales-performance-report.md", score: 0.83 }];

/** One SSE event ("data: {...}") back into its JSON payload. */
function parseEvent(event: string) {
  return JSON.parse(event.trim().slice("data: ".length));
}

describe("createEnvelope", () => {
  it("echoes the requested model and stamps an OpenAI-style id and unix-seconds created", () => {
    const envelope = createEnvelope({ model: "custom" }, new Date("2026-09-24T12:00:00Z"));
    expect(envelope.model).toBe("custom");
    expect(envelope.id).toMatch(/^chatcmpl-[0-9a-f-]{36}$/);
    expect(envelope.created).toBe(Date.UTC(2026, 8, 24, 12) / 1000);
  });

  it("falls back to the public alias when model is missing or empty", () => {
    expect(createEnvelope({}).model).toBe("meridian-assistant");
    expect(createEnvelope({ model: "" }).model).toBe("meridian-assistant");
  });
});

describe("wantsStream", () => {
  it("is true only for an explicit stream: true (OpenAI's default is false)", () => {
    expect(wantsStream({ stream: true })).toBe(true);
    expect(wantsStream({ stream: false })).toBe(false);
    expect(wantsStream({})).toBe(false);
    expect(wantsStream({ stream: "true" })).toBe(false);
  });
});

describe("toCompletionResponse", () => {
  it("builds a full chat.completion with citations and tools on the message", () => {
    expect(toCompletionResponse(ENVELOPE, "Q2 revenue was $18.4M.", CITATIONS, ["lookup_stock"])).toEqual({
      id: "chatcmpl-test",
      created: 1790000000,
      model: "meridian-assistant",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "Q2 revenue was $18.4M.",
            refusal: null,
            citations: CITATIONS,
            tools: ["lookup_stock"],
          },
          logprobs: null,
          finish_reason: "stop",
        },
      ],
    });
  });
});

describe("stream chunks", () => {
  it("wraps every delta in a chat.completion.chunk that shares the envelope", () => {
    for (const event of [
      toRoleChunk(ENVELOPE),
      toTextChunk(ENVELOPE, "Hi"),
      toToolsChunk(ENVELOPE, ["lookup_stock"]),
      toCitationsChunk(ENVELOPE, CITATIONS),
    ]) {
      expect(event.startsWith("data: ")).toBe(true);
      expect(event.endsWith("\n\n")).toBe(true);
      const chunk = parseEvent(event);
      expect(chunk).toMatchObject({ ...ENVELOPE, object: "chat.completion.chunk" });
      expect(chunk.choices[0]).toMatchObject({ index: 0, logprobs: null, finish_reason: null });
    }
  });

  it("carries the role first, then content, then tools, then citations", () => {
    expect(parseEvent(toRoleChunk(ENVELOPE)).choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(parseEvent(toTextChunk(ENVELOPE, "Hi")).choices[0].delta).toEqual({ content: "Hi" });
    expect(parseEvent(toToolsChunk(ENVELOPE, ["lookup_stock"])).choices[0].delta).toEqual({
      tools: ["lookup_stock"],
    });
    expect(parseEvent(toCitationsChunk(ENVELOPE, CITATIONS)).choices[0].delta).toEqual({ citations: CITATIONS });
  });

  it("closes with an empty delta and finish_reason stop, then [DONE]", () => {
    const [finishEvent, doneEvent] = toDoneChunk(ENVELOPE).split("\n\n");
    expect(parseEvent(finishEvent).choices[0]).toMatchObject({ delta: {}, finish_reason: "stop" });
    expect(doneEvent).toBe("data: [DONE]");
  });
});

describe("context usage", () => {
  const CONTEXT = { usedTokens: 13200, maxTokens: 16384, exhausted: true };

  it("travels as its own stream delta", () => {
    expect(parseEvent(toContextChunk(ENVELOPE, CONTEXT)).choices[0].delta).toEqual({ context: CONTEXT });
  });

  it("rides on the voice done event when there is one", () => {
    const [doneEvent] = toVoiceDoneChunk(ENVELOPE, { transcript: "hi", toolsUsed: [], citations: [], context: CONTEXT }).split("\n\n");
    expect(JSON.parse(doneEvent.slice("data: ".length))).toMatchObject({ type: "done", context: CONTEXT });
  });

  it("is left out of the voice done event when nothing was measured", () => {
    const [doneEvent] = toVoiceDoneChunk(ENVELOPE, { transcript: "hi", toolsUsed: [], citations: [] }).split("\n\n");
    expect(JSON.parse(doneEvent.slice("data: ".length))).not.toHaveProperty("context");
  });
});
