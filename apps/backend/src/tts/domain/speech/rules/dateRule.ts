import type { SpeechRule } from '../speechRule.js';
import { ordinalToWords, yearToWords } from '../numberToWords.js';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
/** Full names first, so "June" wins over "Jun"; "Sept" before "Sep". */
const MONTH = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)';
const DAY_MONTH_YEAR_RE = new RegExp(String.raw`\b(\d{1,2})\s+${MONTH}\.?,?\s+(\d{4})\b`, 'g');
const MONTH_DAY_YEAR_RE = new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`, 'g');
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;

function monthNamed(written: string): string | undefined {
  const prefix = written.slice(0, 3).toLowerCase();
  return MONTH_NAMES.find((name) => name.slice(0, 3).toLowerCase() === prefix);
}

/** "June", 12, 2026 → "June twelfth, twenty twenty-six"; `undefined` if the day can't be real. */
function spoken(month: string | undefined, day: number, year: number): string | undefined {
  if (!month || day < 1 || day > 31) return undefined;
  return `${month} ${ordinalToWords(day)}, ${yearToWords(year)}`;
}

/**
 * Says every date the same way, as an English speaker would:
 * "12 Jun 2026", "June 12, 2026" and "2026-06-12" all become "June
 * twelfth, twenty twenty-six". A match that isn't a real date is left as written.
 */
export const dateRule: SpeechRule = {
  apply: (text) =>
    text
      .replace(DAY_MONTH_YEAR_RE, (match, day: string, month: string, year: string) =>
        spoken(monthNamed(month), Number(day), Number(year)) ?? match)
      .replace(MONTH_DAY_YEAR_RE, (match, month: string, day: string, year: string) =>
        spoken(monthNamed(month), Number(day), Number(year)) ?? match)
      .replace(ISO_DATE_RE, (match, year: string, month: string, day: string) =>
        spoken(MONTH_NAMES[Number(month) - 1], Number(day), Number(year)) ?? match),
};
