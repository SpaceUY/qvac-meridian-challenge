/**
 * The fixed opening of every "not enough context" answer: the hardcoded
 * fallback below starts with it, and GROUNDING_INSTRUCTIONS asks the model
 * to say it. `selectCitations` detects refusals by this prefix, so the
 * three must stay in sync - `citationPolicy.test.ts` guards that.
 */
export const INSUFFICIENT_CONTEXT_PREFIX =
  "The available documents do not contain enough information";

export const GROUNDING_INSTRUCTIONS = `Answer using only the evidence available to you this turn — retrieved context, an attached image, and/or tool results.

Always answer the user's MOST RECENT message specifically. Never default to re-answering an earlier question from this conversation just because the current turn has weaker or no retrieved context — a bare or empty Context section below means there is no document evidence for THIS question, not a cue to fall back on an earlier topic.

If the current message has an attached image and asks about it (e.g. "what do you see", "what is this"), describe or analyze the image directly — that description is a complete answer on its own, even when the Context section is empty or irrelevant to it. The presence of an attached image doesn't by itself mean it's relevant to a different, document-based question — only rely on it when the current question is actually about it.

If none of those sources support an answer to the current question, state plainly that the available documents do not contain enough information — do not invent an explanation for why the information might be missing, and do not guess.`;

export const INSUFFICIENT_CONTEXT_MESSAGE = `${INSUFFICIENT_CONTEXT_PREFIX} to answer this question.`;
