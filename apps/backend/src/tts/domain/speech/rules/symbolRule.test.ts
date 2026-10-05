import { describe, expect, it } from 'vitest';
import { symbolRule } from './symbolRule.js';

describe('symbolRule', () => {
  it.each([
    ['+$1.4M beat', 'plus $1.4M beat'],
    ['$620,000 + $480,000', '$620,000 plus $480,000'],
    ['within the ≤ 3.5% guardrail', 'within the at most 3.5% guardrail'],
    ['total ARR → $1.10M', 'total ARR to $1.10M'],
    ['(n = 186)', '(n equals 186)'],
    ['$18.4M vs $16.2M', '$18.4M versus $16.2M'],
    ['$1.2M–$1.5M', '$1.2M to $1.5M'],
    ['$1.2 million–$1.5 million', '$1.2 million to $1.5 million'],
    ['Stage 3 – Technical validation', 'Stage 3, Technical validation'],
  ])('reads %s as %s', (written, spoken) => {
    expect(symbolRule.apply(written)).toBe(spoken);
  });
});
