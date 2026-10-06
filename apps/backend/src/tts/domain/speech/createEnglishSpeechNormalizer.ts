import { SpeechNormalizer } from './speechNormalizer.js';
import { markdownTableRule } from './rules/markdownTableRule.js';
import { markdownCleanupRule } from './rules/markdownCleanupRule.js';
import { codeRule } from './rules/codeRule.js';
import { dateRule } from './rules/dateRule.js';
import { fiscalPeriodRule } from './rules/fiscalPeriodRule.js';
import { symbolRule } from './rules/symbolRule.js';
import { currencyRule } from './rules/currencyRule.js';
import { percentRule } from './rules/percentRule.js';
import { numberRule } from './rules/numberRule.js';

/**
 * The rules for the English voice (DEFAULT_SUPERTONIC_ENGINE_CONFIG's
 * `language: "en"`), in the order they must run. Supporting a new written
 * format means adding a rule here - nothing else changes.
 *
 * 1. Table, then cleanup: the table rule needs the raw "|" rows.
 * 2. Codes before anything numeric: "FIN-SAL-2026-Q2-014" holds a year and a quarter that aren't one.
 * 3. Dates and quarters before money/percent/numbers: their digits are a day or a year, not an amount.
 * 4. Symbols before money and percent: "+$1.4M" → "plus $1.4M", then the amount.
 * 5. Plain numbers last: whatever digits are still left.
 */
export function createEnglishSpeechNormalizer(): SpeechNormalizer {
  return new SpeechNormalizer([
    markdownTableRule,
    markdownCleanupRule,
    codeRule,
    dateRule,
    fiscalPeriodRule,
    symbolRule,
    currencyRule,
    percentRule,
    numberRule,
  ]);
}
