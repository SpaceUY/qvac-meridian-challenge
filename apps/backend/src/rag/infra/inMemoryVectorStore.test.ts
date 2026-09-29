import { describe, expect, it } from 'vitest';
import { InMemoryVectorStore } from './inMemoryVectorStore.js';

describe('InMemoryVectorStore', () => {
  const QUERY = [1, 0];

  // Cosine similarity vs QUERY: chunk-a=1.0, chunk-e=0.8, chunk-c≈0.7071, chunk-b=0.6, chunk-d=0
  const store = new InMemoryVectorStore([
    { id: 'chunk-a', content: 'A', embedding: [2, 0] },
    { id: 'chunk-e', content: 'E', embedding: [4, 3] },
    { id: 'chunk-c', content: 'C', embedding: [1, 1] },
    { id: 'chunk-b', content: 'B', embedding: [3, 4] },
    { id: 'chunk-d', content: 'D', embedding: [0, 5] }
  ]);

  it('drops chunks scoring below minScore', async () => {
    const results = await store.search(QUERY, { topK: 10, minScore: 0.65 });
    expect(results.map((r) => r.id)).toEqual(['chunk-a', 'chunk-e', 'chunk-c']);
  });

  it('caps results at topK even when more chunks pass the threshold', async () => {
    const results = await store.search(QUERY, { topK: 2, minScore: 0.65 });
    expect(results.map((r) => r.id)).toEqual(['chunk-a', 'chunk-e']);
  });

  it('preserves descending-score ranking order', async () => {
    const results = await store.search(QUERY, { topK: 10, minScore: 0 });
    expect(results.map((r) => r.id)).toEqual(['chunk-a', 'chunk-e', 'chunk-c', 'chunk-b', 'chunk-d']);
  });

  it('returns an empty array when nothing meets minScore', async () => {
    // 1.0 is the maximum possible cosine similarity, so 1.01 guarantees no match.
    const results = await store.search(QUERY, { topK: 10, minScore: 1.01 });
    expect(results).toEqual([]);
  });
});
