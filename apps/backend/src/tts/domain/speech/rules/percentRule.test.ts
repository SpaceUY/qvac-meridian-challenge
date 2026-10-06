import { describe, expect, it } from 'vitest';
import { percentRule } from './percentRule.js';

describe('percentRule', () => {
  it('says a percentage in words', () => {
    expect(percentRule.apply('an 8.2% beat, 28% win rate')).toBe('an eight point two percent beat, twenty-eight percent win rate');
  });
});
