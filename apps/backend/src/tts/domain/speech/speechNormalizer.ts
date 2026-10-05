import type { SpeechRule } from './speechRule.js';

/**
 * Turns an answer as written (Markdown, "$1.2M", "OPP-88421") into the
 * words a TTS engine should say. Runs its rules in order, each one on the
 * previous one's output - the order is part of the behavior (see
 * createEnglishSpeechNormalizer).
 */
export class SpeechNormalizer {
  constructor(private readonly rules: readonly SpeechRule[]) {}

  normalize(text: string): string {
    return this.rules.reduce((current, rule) => rule.apply(current), text);
  }
}
