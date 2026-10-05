/** Default engine used when a `ModelSource` doesn't specify one - the only inference engine this feature targets. */
export const DEFAULT_MODEL_TYPE = 'llamacpp-completion';

/** Greedy decoding (temperature 0) has no pressure against repeating itself, so a long list answer can loop forever without this. Mild on purpose - answers legitimately repeat tokens (bullets, file paths). */
export const REPEAT_PENALTY = 1.1;

/** Hard cap so a degenerate loop `REPEAT_PENALTY` doesn't prevent still ends - well above any legitimate reply (~1k tokens) and below the 16k context. */
export const MAX_REPLY_TOKENS = 4096;
