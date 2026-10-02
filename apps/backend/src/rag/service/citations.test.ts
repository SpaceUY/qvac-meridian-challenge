import { describe, expect, it } from 'vitest';
import type { RetrievedChunk } from '../domain/types.js';
import { toCitations, toCitedChunks } from './citations.js';

function chunk(id: string, source: string | undefined, score: number): RetrievedChunk {
  return { id, content: `content of ${id}`, score, source };
}

function indexedChunk(id: string, source: string, score: number, chunkIndex: number): RetrievedChunk {
  return { ...chunk(id, source, score), metadata: { title: 'T', documentType: 'REPORTS', chunkIndex } };
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

describe('toCitedChunks', () => {
  it('groups chunks by cited file in citation order, best chunk first within a file', () => {
    const chunks = [
      indexedChunk('w#2', 'policies/warranty.md', 0.66, 2),
      indexedChunk('q2#4', 'reports/q2.md', 0.71, 4),
      indexedChunk('q2#1', 'reports/q2.md', 0.83, 1)
    ];
    const citations = toCitations(chunks);

    expect(toCitedChunks(chunks, citations)).toEqual([
      { file: 'reports/q2.md', chunkIndex: 1, score: 0.83, content: 'content of q2#1' },
      { file: 'reports/q2.md', chunkIndex: 4, score: 0.71, content: 'content of q2#4' },
      { file: 'policies/warranty.md', chunkIndex: 2, score: 0.66, content: 'content of w#2' }
    ]);
  });

  it('drops chunks of files that are not cited', () => {
    const chunks = [indexedChunk('q2#1', 'reports/q2.md', 0.83, 1), indexedChunk('w#2', 'policies/warranty.md', 0.66, 2)];

    expect(toCitedChunks(chunks, [{ file: 'reports/q2.md', score: 0.83 }]).map((c) => c.file)).toEqual(['reports/q2.md']);
  });

  it('returns nothing when there are no citations, e.g. the model said the documents do not cover it', () => {
    expect(toCitedChunks([indexedChunk('q2#1', 'reports/q2.md', 0.83, 1)], [])).toEqual([]);
  });

  it('rounds the score like the citation does and omits chunkIndex when the chunk has none', () => {
    const [cited] = toCitedChunks([chunk('a#0', 'a.md', 0.123456789)], [{ file: 'a.md', score: 0.1235 }]);

    expect(cited).toEqual({ file: 'a.md', score: 0.1235, content: 'content of a#0' });
    expect('chunkIndex' in cited).toBe(false);
  });
});
