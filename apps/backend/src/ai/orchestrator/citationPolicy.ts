import type { Citation, RetrievedChunk } from "../../rag/domain/types.js";
import { toCitations } from "../../rag/service/citations.js";
import { INSUFFICIENT_CONTEXT_PREFIX } from "./ragGraph.const.js";

/** A reasoning block, in case the runtime ever leaves one inline in the answer text. */
const THINK_BLOCK = /<think>[\s\S]*?<\/think>/g;

/**
 * The ticket's "only documents that genuinely contributed": the chunks that
 * reached the model are cited, UNLESS the model answered that the
 * documents don't cover the question - then nothing was used, and a
 * citation would attach a source to a non-answer.
 *
 * A refusal is detected by the answer STARTING with the prefix, not merely
 * containing it: a partial answer ("The P1 SLA is 4h. The available
 * documents do not contain enough information about P4.") did use its
 * sources and keeps them.
 */
export function selectCitations(answer: string, chunks: RetrievedChunk[]): Citation[] {
  return isInsufficientContextAnswer(answer) ? [] : toCitations(chunks);
}

export function isInsufficientContextAnswer(answer: string): boolean {
  const visible = answer.replace(THINK_BLOCK, "").trim().toLowerCase();
  return visible.startsWith(INSUFFICIENT_CONTEXT_PREFIX.toLowerCase());
}
