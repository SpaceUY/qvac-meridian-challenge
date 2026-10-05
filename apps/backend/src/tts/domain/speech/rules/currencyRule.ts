import type { SpeechRule } from '../speechRule.js';
import { NUMERAL_PATTERN, decimalToWords } from '../numberToWords.js';

/** Scale suffixes, lowercased: "$910K"/"$910k", "$1.2M"/"$1.2m"/"$1.2MM", "$4.5B"/"$4.5bn". */
const SCALE_SUFFIXES: Record<string, string> = { k: 'thousand', m: 'million', mm: 'million', b: 'billion', bn: 'billion' };
/**
 * "$1.2M", "$910k", "$4.5bn", "$2.35 billion", "$1,100,000". A scale letter
 * must end the word: "$5 Bank fees" and "$5 M&A deal" are five dollars.
 */
const CURRENCY_RE = new RegExp(
  String.raw`\$(${NUMERAL_PATTERN})(?:\s?(MM|BN|bn|[KkMmBb])(?![\w&])|\s+(thousand|million|billion|trillion)\b)?`,
  'g',
);

/** "$1.2M" and "$1.2 million" → "one point two million dollars", "$17.0M" → "seventeen million dollars", "$1" → "one dollar". */
export const currencyRule: SpeechRule = {
  apply: (text) =>
    text.replace(CURRENCY_RE, (_match, amount: string, suffix: string | undefined, scaleWord: string | undefined) => {
      const words = decimalToWords(amount);
      const scale = scaleWord ?? (suffix && SCALE_SUFFIXES[suffix.toLowerCase()]);
      if (scale) return `${words} ${scale} dollars`;
      return words === 'one' ? 'one dollar' : `${words} dollars`;
    }),
};
