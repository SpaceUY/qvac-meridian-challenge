import { describe, expect, it } from 'vitest';
import { decimalToWords, digitsToWords, integerToWords, ordinalToWords, yearToWords } from './numberToWords.js';

describe('integerToWords', () => {
  it.each([
    [0, 'zero'],
    [15, 'fifteen'],
    [40, 'forty'],
    [186, 'one hundred eighty-six'],
    [910_000, 'nine hundred ten thousand'],
    [1_000_001, 'one million one'],
    [1_100_000, 'one million one hundred thousand'],
    [2_350_000_000, 'two billion three hundred fifty million'],
  ])('%i → %s', (n, words) => {
    expect(integerToWords(n)).toBe(words);
  });

  it('rejects what it cannot say instead of saying something wrong', () => {
    expect(() => integerToWords(-1)).toThrow(RangeError);
    expect(() => integerToWords(1.5)).toThrow(RangeError);
  });
});

describe('decimalToWords', () => {
  it.each([
    ['1,100,000', 'one million one hundred thousand'],
    ['12.5', 'twelve point five'],
    ['12.50', 'twelve point five'],
    ['17.0', 'seventeen'],
    ['0.05', 'zero point zero five'],
  ])('%s → %s', (numeral, words) => {
    expect(decimalToWords(numeral)).toBe(words);
  });

  it('dictates an integer too big to say as a quantity, instead of throwing', () => {
    expect(decimalToWords('12345678901234567890')).toBe(
      'one two three four five six seven eight nine zero one two three four five six seven eight nine zero',
    );
  });
});

describe('digitsToWords', () => {
  it('reads each digit on its own, the way an identifier is dictated', () => {
    expect(digitsToWords('88421')).toBe('eight eight four two one');
  });
});

describe('ordinalToWords', () => {
  it.each([
    [1, 'first'], [2, 'second'], [3, 'third'], [5, 'fifth'], [8, 'eighth'], [9, 'ninth'],
    [11, 'eleventh'], [12, 'twelfth'], [20, 'twentieth'], [21, 'twenty-first'], [29, 'twenty-ninth'], [31, 'thirty-first'],
  ])('%i → %s', (n, words) => {
    expect(ordinalToWords(n)).toBe(words);
  });
});

describe('yearToWords', () => {
  it.each([
    [2026, 'twenty twenty-six'],
    [2010, 'twenty ten'],
    [2005, 'two thousand five'],
    [2000, 'two thousand'],
    [1984, 'nineteen eighty-four'],
    [1905, 'nineteen oh five'],
    [1900, 'nineteen hundred'],
  ])('%i → %s', (year, words) => {
    expect(yearToWords(year)).toBe(words);
  });
});
