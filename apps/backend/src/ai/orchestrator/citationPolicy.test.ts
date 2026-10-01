import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../../rag/domain/types.js";
import { isInsufficientContextAnswer, selectCitations } from "./citationPolicy.js";
import {
  GROUNDING_INSTRUCTIONS,
  INSUFFICIENT_CONTEXT_MESSAGE,
  INSUFFICIENT_CONTEXT_PREFIX,
} from "./ragGraph.const.js";

const CHUNKS: RetrievedChunk[] = [
  { id: "q2#0", content: "Q2 revenue was $18.4M.", score: 0.83, source: "reports/q2-2026-sales-performance-report.md" },
];

describe("selectCitations", () => {
  it("cites the retrieved documents for a grounded answer", () => {
    expect(selectCitations("Q2 2026 total revenue was $18.4M.", CHUNKS)).toEqual([
      { file: "reports/q2-2026-sales-performance-report.md", score: 0.83 },
    ]);
  });

  it("returns no citations when the model says the documents don't cover it", () => {
    const refusal = "The available documents do not contain enough information to determine Meridian's CEO.";
    expect(selectCitations(refusal, CHUNKS)).toEqual([]);
  });

  it("keeps citations for a partial answer that only mentions the refusal later", () => {
    const partial = "The P1 SLA is 4 hours. The available documents do not contain enough information about P4.";
    expect(selectCitations(partial, CHUNKS)).toHaveLength(1);
  });
});

describe("isInsufficientContextAnswer", () => {
  it("ignores case, surrounding whitespace and an inline <think> block", () => {
    const answer = "  <think>hmm</think>\nthe AVAILABLE documents do not contain enough information.";
    expect(isInsufficientContextAnswer(answer)).toBe(true);
  });

  it("recognizes the graph's own hardcoded fallback", () => {
    expect(isInsufficientContextAnswer(INSUFFICIENT_CONTEXT_MESSAGE)).toBe(true);
  });

  it("stays in sync with the sentence the prompt asks the model to say", () => {
    expect(GROUNDING_INSTRUCTIONS.toLowerCase()).toContain(INSUFFICIENT_CONTEXT_PREFIX.toLowerCase());
  });

  it("tells the model to answer the latest message instead of an earlier turn's topic", () => {
    // Regression guard for a real repro: attaching an image and asking "what
    // do you see" made the model ignore the image and re-answer a previous
    // turn's document question (with a fabricated excuse) once retrieval for
    // the new turn came back empty. Confirmed fixed manually against the
    // live model; this just guards the instruction text from being reverted.
    const lower = GROUNDING_INSTRUCTIONS.toLowerCase();
    expect(lower).toContain("most recent message");
    expect(lower).toContain("describe or analyze the image directly");
  });
});
