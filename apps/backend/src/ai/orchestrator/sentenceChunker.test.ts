import { describe, expect, it } from "vitest";
import { SentenceChunker } from "./sentenceChunker.js";

describe("SentenceChunker", () => {
  it("emits nothing while the buffered text stays under the minimum chunk size", () => {
    const chunker = new SentenceChunker(50);
    expect(chunker.push("Hi.")).toEqual([]);
  });

  it("bundles multiple short sentences until the threshold is reached, cutting at the next sentence boundary", () => {
    const chunker = new SentenceChunker(10);
    expect(chunker.push("Hi. ")).toEqual([]);
    expect(chunker.push("Ok. ")).toEqual([]);
    expect(chunker.push("There we go.")).toEqual(["Hi. Ok. There we go."]);
  });

  it("emits as soon as the buffer crosses the threshold and a sentence boundary follows", () => {
    const chunker = new SentenceChunker(5);
    expect(chunker.push("Ab cd ef.")).toEqual(["Ab cd ef."]);
  });

  it("emits multiple sentences from a single push when more than one boundary qualifies", () => {
    const chunker = new SentenceChunker(1);
    expect(chunker.push("One. Two. Three.")).toEqual(["One.", "Two.", "Three."]);
  });

  it("treats '!' and '?' as sentence boundaries too", () => {
    const chunker = new SentenceChunker(1);
    expect(chunker.push("Really?! Yes.")).toEqual(["Really?!", "Yes."]);
  });

  it("keeps accumulating when the threshold is reached but no sentence boundary has arrived yet", () => {
    const chunker = new SentenceChunker(5);
    expect(chunker.push("no punctuation yet")).toEqual([]);
  });

  describe("flush", () => {
    it("returns the remaining buffered text and clears it", () => {
      const chunker = new SentenceChunker(100);
      chunker.push("an unfinished answer with no terminal punctuation");

      expect(chunker.flush()).toBe("an unfinished answer with no terminal punctuation");
      expect(chunker.flush()).toBeUndefined();
    });

    it("returns undefined when nothing is buffered", () => {
      const chunker = new SentenceChunker(100);
      expect(chunker.flush()).toBeUndefined();
    });
  });
});
