import { describe, expect, it } from 'vitest';
import { toRetrievalQuery } from './retrievalQuery.js';

describe('toRetrievalQuery', () => {
  it('returns the trimmed text unchanged when it fits', () => {
    expect(toRetrievalQuery('  What is the SLA?  ', 700)).toBe('What is the SLA?');
  });

  it('keeps a text that is exactly at the limit', () => {
    expect(toRetrievalQuery('abcde', 5)).toBe('abcde');
  });

  it('keeps only the first maxChars characters of a longer text', () => {
    expect(toRetrievalQuery('0123456789-tail', 10)).toBe('0123456789');
  });

  it('never ends on half of an emoji (a UTF-16 surrogate pair)', () => {
    // 'ab😀' is 4 UTF-16 units: a, b, high surrogate, low surrogate.
    expect(toRetrievalQuery('ab😀', 3)).toBe('ab');
  });

  it('drops whitespace left at the cut', () => {
    expect(toRetrievalQuery('hello world', 6)).toBe('hello');
  });
});
