/** Default engine used when a `ModelSource` doesn't specify one - the only inference engine this feature targets. */
export const DEFAULT_MODEL_TYPE = 'llamacpp-completion';

/**
 * Penalty applied to tokens the model already produced recently. Greedy
 * decoding (temperature 0) on a small model has no pressure against
 * repeating itself, so a long list answer can fall into a loop - e.g. the
 * same document line forever after "List all documents.". Mild on purpose:
 * answers legitimately repeat tokens (list bullets, file paths).
 */
export const REPEAT_PENALTY = 1.1;

/**
 * Hard cap on tokens generated per completion call, so a degenerate loop
 * that `REPEAT_PENALTY` doesn't prevent still ends instead of running until
 * the context window is full. Well above any legitimate reply or tool call
 * (a 30-document listing is ~1k tokens) and well below the 16k context.
 */
export const MAX_REPLY_TOKENS = 4096;
