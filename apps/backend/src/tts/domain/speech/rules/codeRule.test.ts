import { describe, expect, it } from 'vitest';
import { codeRule } from './codeRule.js';

describe('codeRule', () => {
  it.each([
    ['OPP-88421', 'O P P, eight eight four two one'],
    ['FIN-SAL-2026-Q2-014', 'F I N, S A L, two zero two six, Q two, zero one four'],
    ['SD-X4-001', 'S D, X four, zero zero one'],
    ['CL-GW-REV-C', 'C L, G W, R E V, C'],
  ])('dictates %s as %s', (code, words) => {
    expect(codeRule.apply(`(${code})`)).toBe(`(${words})`);
  });

  it('leaves lowercase hyphenated words and ISO dates alone', () => {
    expect(codeRule.apply('a year-to-date view on 2026-06-12')).toBe('a year-to-date view on 2026-06-12');
  });
});
