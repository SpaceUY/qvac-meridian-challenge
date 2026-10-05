import { describe, expect, it } from 'vitest';
import { markdownTableRule } from './markdownTableRule.js';

const TABLE = [
  '| Metric | Actual | Target/Plan | Variance |',
  '|---|---|---|---|',
  '| **Total Revenue** | $18.4M | $17.0M | +$1.4M (8.2% beat) |',
  '| **New ARR Bookings** | $3.9M | — | — |',
].join('\n');

describe('markdownTableRule', () => {
  it('reads each row as one sentence that names its columns, skipping empty cells', () => {
    expect(markdownTableRule.apply(TABLE)).toBe(
      '**Total Revenue**: Actual $18.4M, Target/Plan $17.0M, Variance +$1.4M (8.2% beat).\n' +
        '**New ARR Bookings**: Actual $3.9M.',
    );
  });

  it('leaves the text around the table, and its line breaks, where they were', () => {
    expect(markdownTableRule.apply(`Summary:\n\n${TABLE}\n\nBoth deals closed.`)).toBe(
      'Summary:\n\n' +
        '**Total Revenue**: Actual $18.4M, Target/Plan $17.0M, Variance +$1.4M (8.2% beat).\n' +
        '**New ARR Bookings**: Actual $3.9M.\n\nBoth deals closed.',
    );
  });

  it('reads a table without a header row as plain lists of cells', () => {
    expect(markdownTableRule.apply('| Atlas | $2.35M |\n| Helix | n/a |')).toBe('Atlas: $2.35M.\nHelix.');
  });

  it('leaves text without tables untouched', () => {
    expect(markdownTableRule.apply('Revenue grew. No table here.')).toBe('Revenue grew. No table here.');
  });
});
