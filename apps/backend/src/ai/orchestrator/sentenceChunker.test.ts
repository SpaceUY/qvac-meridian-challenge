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
    expect(chunker.push("There we go.")).toEqual([]);
    expect(chunker.push(" ")).toEqual(["Hi. Ok. There we go."]);
  });

  it("emits as soon as the buffer crosses the threshold and a sentence boundary follows", () => {
    const chunker = new SentenceChunker(5);
    expect(chunker.push("Ab cd ef. ")).toEqual(["Ab cd ef."]);
  });

  it("emits multiple sentences from a single push when more than one boundary qualifies", () => {
    const chunker = new SentenceChunker(1);
    expect(chunker.push("One. Two. Three. ")).toEqual(["One.", " Two.", " Three."]);
  });

  it("treats '!' and '?' as sentence boundaries too", () => {
    const chunker = new SentenceChunker(1);
    expect(chunker.push("Really?! Yes. ")).toEqual(["Really?!", " Yes."]);
  });

  it("keeps the line breaks after a sentence end at the start of the next chunk", () => {
    const chunker = new SentenceChunker(1);
    expect(chunker.push("One.\n\n## Two.\n")).toEqual(["One.", "\n\n## Two."]);
  });

  it("reproduces the streamed text exactly when every chunk is joined back together", () => {
    const answer =
      "Gloves make typing impractical. The system uses local packs.\n\n" +
      "## Key Rules\n\n1. **Docked Refresh** - Refreshes weekly.\n2. **Stale Warning** - Warns after 10 days.";
    const chunker = new SentenceChunker(40);
    const chunks: string[] = [];
    for (let i = 0; i < answer.length; i += 3) {
      chunks.push(...chunker.push(answer.slice(i, i + 3)));
    }
    chunks.push(chunker.flush() ?? "");

    expect(chunks.join("")).toBe(answer);
  });

  it("waits for the whitespace after a period before cutting - the period may still be a decimal point", () => {
    const chunker = new SentenceChunker(1);
    expect(chunker.push("Logo churn: 3")).toEqual([]);
    expect(chunker.push(".")).toEqual([]);
    expect(chunker.push("1% (within the guardrail). ")).toEqual(["Logo churn: 3.1% (within the guardrail)."]);
  });

  it("does not cut after a number that opens a line - that is a list marker", () => {
    const chunker = new SentenceChunker(1);
    expect(chunker.push("Steps:\n1. Open it.\n2. Close it. ")).toEqual(["Steps:\n1. Open it.", "\n2. Close it."]);
  });

  it("never cuts inside a Markdown table, and ends the chunk where the table ends", () => {
    const table = "| Metric | Actual |\n|---|---|\n| Revenue | $1.2M. Up |\n| Margin | 34.5% |\n";
    const chunker = new SentenceChunker(1);
    expect(chunker.push(`Summary:\n\n${table}`)).toEqual([]);
    expect(chunker.push("\nBoth deals closed. ")).toEqual([`Summary:\n\n${table}`, "\nBoth deals closed."]);
  });

  it("keeps a table whole even when it streams in small pieces", () => {
    const answer = "Summary:\n\n| Metric | Actual |\n|---|---|\n| Revenue | $1.2M. Up |\n| Margin | 34.5% |\n\nBoth deals closed. Done.";
    const chunker = new SentenceChunker(1);
    const chunks: string[] = [];
    for (let i = 0; i < answer.length; i += 3) chunks.push(...chunker.push(answer.slice(i, i + 3)));
    chunks.push(chunker.flush() ?? "");

    expect(chunks.join("")).toBe(answer);
    expect(chunks[0]).toBe("Summary:\n\n| Metric | Actual |\n|---|---|\n| Revenue | $1.2M. Up |\n| Margin | 34.5% |\n");
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

    it("returns a whitespace-only remainder as-is instead of dropping it", () => {
      const chunker = new SentenceChunker(1);
      chunker.push("Done.\n");

      expect(chunker.flush()).toBe("\n");
    });

    it("returns undefined when nothing is buffered", () => {
      const chunker = new SentenceChunker(100);
      expect(chunker.flush()).toBeUndefined();
    });
  });
});
