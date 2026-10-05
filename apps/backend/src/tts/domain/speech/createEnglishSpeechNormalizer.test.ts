import { describe, expect, it } from 'vitest';
import { createEnglishSpeechNormalizer } from './createEnglishSpeechNormalizer.js';

const normalize = (text: string) => createEnglishSpeechNormalizer().normalize(text);

describe('createEnglishSpeechNormalizer', () => {
  it('reads a sentence with a date, a code, an amount, a percentage and a quarter', () => {
    expect(normalize('Atlas closed on 12 Jun 2026 (OPP-88421) for $1.2M, up 12.5% in Q2 2026.')).toBe(
      'Atlas closed on June twelfth, twenty twenty-six (O P P, eight eight four two one) for one point two million dollars, up twelve point five percent in Q two, twenty twenty-six.',
    );
  });

  it('keeps a code\'s year and quarter inside the code', () => {
    expect(normalize('Report (FIN-SAL-2026-Q2-014)')).toBe('Report (F I N, S A L, two zero two six, Q two, zero one four).');
  });

  it('reads a Markdown answer with a table the way a person would say it', () => {
    const answer = [
      '### Key Financial Results',
      '',
      '| Metric | Actual | Target/Plan | Variance |',
      '|---|---|---|---|',
      '| **Total Revenue** | $18.4M | $17.0M | +$1.4M (8.2% beat) |',
      '| **New ARR Bookings** | $3.9M | — | — |',
      '',
      '- **Logo churn**: 3.1% (within the ≤ 3.5% guardrail)',
      '- **NPS Score**: 47 (n = 186), up from Q1\'s 41',
      '',
      '---',
      'Revenue: $18.4M (Q2) vs $16.2M (Q1) — +$2.2M increase',
    ].join('\n');

    expect(normalize(answer)).toBe(
      'Key Financial Results. ' +
        'Total Revenue: Actual eighteen point four million dollars, Target/Plan seventeen million dollars, Variance plus one point four million dollars (eight point two percent beat). ' +
        'New ARR Bookings: Actual three point nine million dollars. ' +
        'Logo churn: three point one percent (within the at most three point five percent guardrail). ' +
        "NPS Score: forty-seven (n equals one hundred eighty-six), up from Q one's forty-one. " +
        'Revenue: eighteen point four million dollars (Q two) versus sixteen point two million dollars (Q one), plus two point two million dollars increase.',
    );
  });

  it('has nothing to say for text that is only Markdown decoration', () => {
    expect(normalize('---')).toBe('');
  });
});
