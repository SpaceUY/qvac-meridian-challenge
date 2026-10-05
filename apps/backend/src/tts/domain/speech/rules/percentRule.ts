import type { SpeechRule } from '../speechRule.js';
import { NUMERAL_PATTERN, decimalToWords } from '../numberToWords.js';

const PERCENT_RE = new RegExp(String.raw`(${NUMERAL_PATTERN})\s?%`, 'g');

/** "8.2%" → "eight point two percent". */
export const percentRule: SpeechRule = {
  apply: (text) => text.replace(PERCENT_RE, (_match, amount: string) => `${decimalToWords(amount)} percent`),
};
