import { describe, expect, it } from 'vitest';
import { dateRule } from './dateRule.js';

describe('dateRule', () => {
  it.each([
    ['12 June 2026', 'June twelfth, twenty twenty-six'],
    ['12 Jun 2026', 'June twelfth, twenty twenty-six'],
    ['1 Aug 2026', 'August first, twenty twenty-six'],
    ['June 12, 2026', 'June twelfth, twenty twenty-six'],
    ['2026-06-24', 'June twenty-fourth, twenty twenty-six'],
  ])('says %s as %s', (written, spoken) => {
    expect(dateRule.apply(`Closed ${written}.`)).toBe(`Closed ${spoken}.`);
  });

  it('leaves a date that cannot be real as written', () => {
    expect(dateRule.apply('2026-13-40 and 45 June 2026')).toBe('2026-13-40 and 45 June 2026');
  });
});
