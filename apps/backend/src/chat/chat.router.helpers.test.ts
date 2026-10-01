import { describe, expect, it } from "vitest";
import {
  parseMessages,
  parseHistory,
  parseAudioBase64,
  createEnvelope,
  wantsStream,
  toCompletionResponse,
  toRoleChunk,
  toTextChunk,
  toCitationsChunk,
  toDoneChunk,
} from "./chat.router.helpers.js";

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
  it("builds a full chat.completion with citations on the message", () => {
    expect(toCompletionResponse(ENVELOPE, "Q2 revenue was $18.4M.", CITATIONS)).toEqual({
      id: "chatcmpl-test",
      created: 1790000000,
      model: "meridian-assistant",
      object: "chat.completion",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Q2 revenue was $18.4M.", refusal: null, citations: CITATIONS },
          logprobs: null,
          finish_reason: "stop",
        },
      ],
    });
  });
});

describe("stream chunks", () => {
  it("wraps every delta in a chat.completion.chunk that shares the envelope", () => {
    for (const event of [toRoleChunk(ENVELOPE), toTextChunk(ENVELOPE, "Hi"), toCitationsChunk(ENVELOPE, CITATIONS)]) {
      expect(event.startsWith("data: ")).toBe(true);
      expect(event.endsWith("\n\n")).toBe(true);
      const chunk = parseEvent(event);
      expect(chunk).toMatchObject({ ...ENVELOPE, object: "chat.completion.chunk" });
      expect(chunk.choices[0]).toMatchObject({ index: 0, logprobs: null, finish_reason: null });
    }
  });

  it("carries the role first, then content, then citations", () => {
    expect(parseEvent(toRoleChunk(ENVELOPE)).choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(parseEvent(toTextChunk(ENVELOPE, "Hi")).choices[0].delta).toEqual({ content: "Hi" });
    expect(parseEvent(toCitationsChunk(ENVELOPE, CITATIONS)).choices[0].delta).toEqual({ citations: CITATIONS });
  });

  it("closes with an empty delta and finish_reason stop, then [DONE]", () => {
    const [finishEvent, doneEvent] = toDoneChunk(ENVELOPE).split("\n\n");
    expect(parseEvent(finishEvent).choices[0]).toMatchObject({ delta: {}, finish_reason: "stop" });
    expect(doneEvent).toBe("data: [DONE]");
  });
});
