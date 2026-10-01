/**
 * The fixed opening of every "not enough context" answer: the hardcoded
 * fallback below starts with it, and GROUNDING_INSTRUCTIONS asks the model
 * to say it. `selectCitations` detects refusals by this prefix, so the
 * three must stay in sync - `citationPolicy.test.ts` guards that.
 */
export const INSUFFICIENT_CONTEXT_PREFIX =
  "The available documents do not contain enough information";

export const GROUNDING_INSTRUCTIONS = `Answer using only the provided context.

If the answer cannot be supported by the retrieved context, state that the available documents do not contain enough information.

Do not invent unsupported facts.`;

export const INSUFFICIENT_CONTEXT_MESSAGE = `${INSUFFICIENT_CONTEXT_PREFIX} to answer this question.`;
