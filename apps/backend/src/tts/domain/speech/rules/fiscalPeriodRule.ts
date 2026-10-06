import type { SpeechRule } from '../speechRule.js';
import { digitsToWords, yearToWords } from '../numberToWords.js';

/** "Q2", "Q2 2026", "Q2 FY2026". */
const QUARTER_RE = /\bQ([1-4])(?:\s+(?:FY\s?)?(\d{4}))?\b/g;
const FISCAL_YEAR_RE = /\bFY\s?(\d{4})\b/g;

/** "Q2 2026" → "Q two, twenty twenty-six"; "Q1" → "Q one"; "FY2026" → "F Y twenty twenty-six". */
export const fiscalPeriodRule: SpeechRule = {
  apply: (text) =>
    text
      .replace(QUARTER_RE, (_match, quarter: string, year: string | undefined) =>
        year ? `Q ${digitsToWords(quarter)}, ${yearToWords(Number(year))}` : `Q ${digitsToWords(quarter)}`)
      .replace(FISCAL_YEAR_RE, (_match, year: string) => `F Y ${yearToWords(Number(year))}`),
};
