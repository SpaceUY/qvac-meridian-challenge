import { describe, expect, it } from 'vitest';
import type { RetrievedChunk } from '../domain/types.js';
import { toCitations } from './citations.js';

function chunk(id: string, source: string | undefined, score: number): RetrievedChunk {
  return { id, content: `content of ${id}`, score, source };
}

describe('toCitations', () => {
  it('returns one citation per file, carrying that file best score', () => {
    const citations = toCitations([
      chunk('q2#0', 'reports/q2.md', 0.71),
      chunk('q2#1', 'reports/q2.md', 0.83),
      chunk('w#0', 'policies/warranty.md', 0.66)
    ]);
    expect(citations).toEqual([
      { file: 'reports/q2.md', score: 0.83 },
      { file: 'policies/warranty.md', score: 0.66 }
    ]);
  });

  it('sorts best-first and breaks ties by path, so the order is deterministic', () => {
    const citations = toCitations([chunk('z', 'z.md', 0.7), chunk('a', 'a.md', 0.7), chunk('m', 'm.md', 0.9)]);
    expect(citations.map((citation) => citation.file)).toEqual(['m.md', 'a.md', 'z.md']);
  });

  it('skips chunks without a source', () => {
    expect(toCitations([chunk('x', undefined, 0.9)])).toEqual([]);
  });

  it('returns an empty array for no chunks', () => {
    expect(toCitations([])).toEqual([]);
  });

  it('rounds the score to 4 decimals', () => {
    expect(toCitations([chunk('a', 'a.md', 0.123456789)])).toEqual([{ file: 'a.md', score: 0.1235 }]);
  });

  it('emits exactly the evaluator shape: file and score, nothing else', () => {
    const [citation] = toCitations([{ ...chunk('a', 'a.md', 0.8), metadata: { title: 'A', chunkIndex: 0 } }]);
    expect(Object.keys(citation).sort()).toEqual(['file', 'score']);
  });
});
