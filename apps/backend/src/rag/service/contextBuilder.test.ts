import { describe, expect, it } from 'vitest';
import type { RetrievedChunk } from '../domain/types.js';
import { buildGroundedContext } from './contextBuilder.js';

describe('buildGroundedContext', () => {
  it('includes source, id, and title when all are available', () => {
    const chunk: RetrievedChunk = {
      id: 'chunk-sla-p1',
      content: 'Enterprise P1 first-response SLA is 4 hours.',
      score: 0.9,
      source: 'support-sla-faq.html',
      metadata: { title: 'Support SLA - Internal FAQ' }
    };

    expect(buildGroundedContext([chunk])).toBe(
      '[Source: support-sla-faq.html | id: chunk-sla-p1 | title: Support SLA - Internal FAQ]\n' +
        'Enterprise P1 first-response SLA is 4 hours.'
    );
  });

  it('omits the title segment when metadata has no title', () => {
    const chunk: RetrievedChunk = {
      id: 'chunk-warranty-01',
      content: 'Warranty covers 24 months.',
      score: 0.8,
      source: 'warranty-terms.md'
    };

    expect(buildGroundedContext([chunk])).toBe(
      '[Source: warranty-terms.md | id: chunk-warranty-01]\nWarranty covers 24 months.'
    );
  });

  it('omits the source segment when source is unset', () => {
    const chunk: RetrievedChunk = {
      id: 'chunk-x',
      content: 'Some content.',
      score: 0.7
    };

    expect(buildGroundedContext([chunk])).toBe('[id: chunk-x]\nSome content.');
  });

  it('joins multiple chunks with a blank line, preserving the given order', () => {
    const chunks: RetrievedChunk[] = [
      { id: 'a', content: 'First.', score: 0.9, source: 'a.md' },
      { id: 'b', content: 'Second.', score: 0.8, source: 'b.md' }
    ];

    expect(buildGroundedContext(chunks)).toBe('[Source: a.md | id: a]\nFirst.\n\n[Source: b.md | id: b]\nSecond.');
  });

  it('returns an empty string for no chunks', () => {
    expect(buildGroundedContext([])).toBe('');
  });
});
