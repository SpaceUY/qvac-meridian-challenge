import type { SpeechRule } from '../speechRule.js';

/** [pattern, words] in order: a range dash must be read before a dash that is just a pause. */
const SYMBOLS: ReadonlyArray<readonly [RegExp, string]> = [
  [/(?<=\d(?:%|[KMBkmb]|bn|MM|\s(?:thousand|million|billion|trillion))?)\s*[–—]\s*(?=[$\d])/g, ' to '], // "$1.2M–$1.5M", "$1.2 million–$1.5 million", "10–20%"
  [/(?<=^|[\s(])\+\s*(?=[$\d])/gm, 'plus '], // "+$1.4M", "+ $480,000", "+12%"
  [/(?<=^|[\s(])[~≈]\s*(?=[$\d])/gm, 'about '], // "~$2M"
  [/\s*(?:→|->)\s*/g, ' to '],
  [/\s*≤\s*/g, ' at most '],
  [/\s*≥\s*/g, ' at least '],
  [/\s+=\s+/g, ' equals '], // "n = 186"
  [/\s+&\s+/g, ' and '],
  [/\bvs\.?(?=\s)/gi, 'versus'],
  [/\s*[–—]\s*/g, ', '], // a dash between words is a pause
  [/ {2,}/g, ' '],
];

/**
 * Reads the symbols that show up in sales answers - "+$1.4M" → "plus
 * $1.4M", "≤ 3.5%" → "at most 3.5%", "→" → "to". Runs before the money
 * and percent rules, which then read the amounts it left in place.
 */
export const symbolRule: SpeechRule = {
  apply: (text) => SYMBOLS.reduce((current, [pattern, words]) => current.replace(pattern, words), text),
};
