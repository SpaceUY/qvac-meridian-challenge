import type { Citation, RetrievedChunk } from "../../rag/domain/types.js";
import { toCitations } from "../../rag/service/citations.js";
import { INSUFFICIENT_CONTEXT_PREFIX } from "./ragGraph.const.js";

/** A reasoning block, in case the runtime ever leaves one inline in the answer text. */
const THINK_BLOCK = /<think>[\s\S]*?<\/think>/g;

/** Cites the chunks that reached the model, unless the answer is a refusal (starts with, not merely contains, the insufficient-context prefix — a partial answer that hedges on part of the question still keeps its citations). */
export function selectCitations(answer: string, chunks: RetrievedChunk[]): Citation[] {
  return isInsufficientContextAnswer(answer) ? [] : toCitations(chunks);
}

export function isInsufficientContextAnswer(answer: string): boolean {
  const visible = answer.replace(THINK_BLOCK, "").trim().toLowerCase();
  return visible.startsWith(INSUFFICIENT_CONTEXT_PREFIX.toLowerCase());
}
