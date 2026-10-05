import { describe, expect, it } from 'vitest';
import { SpeechNormalizer } from './speechNormalizer.js';
import type { SpeechRule } from './speechRule.js';

const appending = (suffix: string): SpeechRule => ({ apply: (text) => `${text}${suffix}` });

describe('SpeechNormalizer', () => {
  it('runs each rule on the previous rule\'s output, in order', () => {
    const normalizer = new SpeechNormalizer([appending('-a'), appending('-b')]);
    expect(normalizer.normalize('x')).toBe('x-a-b');
  });

  it('returns the text unchanged when there are no rules', () => {
    expect(new SpeechNormalizer([]).normalize('$1.2M')).toBe('$1.2M');
  });
});
