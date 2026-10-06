import type { SpeechRule } from '../speechRule.js';
import { digitsToWords } from '../numberToWords.js';

/** An identifier: uppercase letters and digits in two or more hyphen-joined parts - OPP-88421, FIN-SAL-2026-Q2-014, SD-X4-001. */
const CODE_RE = /\b[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+\b/g;

/** "X4" → "X four": letters spelled, digits one by one. */
function dictatePart(part: string): string {
  return [...part].map((char) => (/\d/.test(char) ? digitsToWords(char) : char)).join(' ');
}

/**
 * Dictates document and deal identifiers the way a person reads them out:
 * "OPP-88421" → "O P P, eight eight four two one". Runs before every rule
 * that touches numbers - a code's digits belong to the code, not to a
 * year or a quarter.
 */
export const codeRule: SpeechRule = {
  apply: (text) => text.replace(CODE_RE, (code) => code.split('-').map(dictatePart).join(', ')),
};
