import { describe, expect, it } from 'vitest';
import { currencyRule } from './currencyRule.js';

describe('currencyRule', () => {
  it.each([
    ['$1.2M', 'one point two million dollars'],
    ['$17.0M', 'seventeen million dollars'],
    ['$1.10M', 'one point one million dollars'],
    ['$910K', 'nine hundred ten thousand dollars'],
    ['$1,100,000', 'one million one hundred thousand dollars'],
    ['$1', 'one dollar'],
    ['$1.2 million', 'one point two million dollars'],
    ['$2.35 billion', 'two point three five billion dollars'],
    ['$1 million', 'one million dollars'],
    ['$910k', 'nine hundred ten thousand dollars'],
    ['$4.5bn', 'four point five billion dollars'],
  ])('says %s as %s', (written, spoken) => {
    expect(currencyRule.apply(`${written}.`)).toBe(`${spoken}.`);
  });

  it('keeps the punctuation after an amount', () => {
    expect(currencyRule.apply('$1,100,000, then $3.9M,')).toBe(
      'one million one hundred thousand dollars, then three point nine million dollars,',
    );
  });

  it('only reads K, M or B as a scale when it ends the word', () => {
    expect(currencyRule.apply('$5 Bank fees')).toBe('five dollars Bank fees');
    expect(currencyRule.apply('$5 M&A deal')).toBe('five dollars M&A deal');
  });
});
