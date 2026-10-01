import { describe, expect, it } from "vitest";
import { parseMessages, parseHistory, parseAudioBase64 } from "./chat.router.helpers.js";

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
