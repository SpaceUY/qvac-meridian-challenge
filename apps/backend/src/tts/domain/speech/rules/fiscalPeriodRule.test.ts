import { describe, expect, it } from 'vitest';
import { fiscalPeriodRule } from './fiscalPeriodRule.js';

describe('fiscalPeriodRule', () => {
  it.each([
    ['Q2 2026 revenue', 'Q two, twenty twenty-six revenue'],
    ['Q2 vs Q1', 'Q two vs Q one'],
    ["up from Q1's 41", "up from Q one's 41"],
    ['FY2026 YTD', 'F Y twenty twenty-six YTD'],
  ])('says %s as %s', (written, spoken) => {
    expect(fiscalPeriodRule.apply(written)).toBe(spoken);
  });
});
