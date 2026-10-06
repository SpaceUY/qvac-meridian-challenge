import type { SpeechRule } from '../speechRule.js';
import { NUMERAL_PATTERN, decimalToWords, yearToWords } from '../numberToWords.js';

/** A number standing alone - not glued to letters ("3rd", "X4") or to another number. */
const NUMBER_RE = new RegExp(String.raw`(?<![\w.,])${NUMERAL_PATTERN}(?!\w|[.,]\d)`, 'g');
/** Four digits from 1900 to 2099 with no comma: almost always a year in these answers. */
const YEAR_LIKE_RE = /^(?:19|20)\d{2}$/;

/**
 * Says every number the earlier rules left in place: "186" → "one hundred
 * eighty-six", "3.1" → "three point one", "in 2026" → "in twenty
 * twenty-six". Runs last, so a number that belongs to a date, a code or an
 * amount has already been read by its own rule.
 */
export const numberRule: SpeechRule = {
  apply: (text) =>
    text.replace(NUMBER_RE, (numeral) =>
      YEAR_LIKE_RE.test(numeral) ? yearToWords(Number(numeral)) : decimalToWords(numeral)),
};
