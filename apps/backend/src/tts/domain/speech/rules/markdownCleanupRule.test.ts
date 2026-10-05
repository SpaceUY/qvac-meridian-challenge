import { describe, expect, it } from 'vitest';
import { markdownCleanupRule } from './markdownCleanupRule.js';

describe('markdownCleanupRule', () => {
  it('drops heading marks, bullets, bold, italics and inline code', () => {
    expect(markdownCleanupRule.apply('### Key Results\n- **Logo churn**: *low*, see `CHURN`')).toBe(
      'Key Results. Logo churn: low, see CHURN.',
    );
  });

  it('ends every line with a pause and joins the lines into one', () => {
    expect(markdownCleanupRule.apply('Performance Highlights\nWin rate: 28% (Q2)\n\nDone.')).toBe(
      'Performance Highlights. Win rate: 28% (Q2). Done.',
    );
  });

  it('drops horizontal rules, leaving nothing to say when that is all there was', () => {
    expect(markdownCleanupRule.apply('---')).toBe('');
    expect(markdownCleanupRule.apply('First.\n---\nSecond.')).toBe('First. Second.');
  });

  it('keeps a line that already ends in punctuation as it is', () => {
    expect(markdownCleanupRule.apply('Here is the summary:')).toBe('Here is the summary:');
  });
});
