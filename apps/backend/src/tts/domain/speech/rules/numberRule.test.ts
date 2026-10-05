import { describe, expect, it } from 'vitest';
import { numberRule } from './numberRule.js';

describe('numberRule', () => {
  it('says standalone numbers, keeping the punctuation around them', () => {
    expect(numberRule.apply('NPS 47, up from 41 (n equals 186). Churn 3.1.')).toBe(
      'NPS forty-seven, up from forty-one (n equals one hundred eighty-six). Churn three point one.',
    );
  });

  it('reads a four-digit number from 1900 to 2099 as a year', () => {
    expect(numberRule.apply('in 2026 we shipped 4,096 units')).toBe('in twenty twenty-six we shipped four thousand ninety-six units');
  });

  it('leaves numbers glued to letters alone', () => {
    expect(numberRule.apply('the 3rd attempt')).toBe('the 3rd attempt');
  });
});
