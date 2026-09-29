import { describe, expect, it } from 'vitest';
import { FakeEmbeddingPort } from '../fakeEmbedding.adapter.js';
import { buildFixtureVectorStore } from './corpus-chunks.fixture.js';

describe('corpus-chunks fixtures + InMemoryVectorStore + FakeEmbeddingPort', () => {
  it('ranks the matching chunk highest and clears a tuned minScore for an on-topic query', async () => {
    const embeddingPort = new FakeEmbeddingPort();
    const store = await buildFixtureVectorStore(embeddingPort);

    const queryEmbedding = await embeddingPort.embed('What is the enterprise P1 first response SLA?');
    const results = await store.search(queryEmbedding, { topK: 3, minScore: 0.3 });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('chunk-sla-p1');
    expect(results[0].source).toBe('support-sla-faq.html');
  });

  it('returns nothing for an off-topic query at the same threshold', async () => {
    const embeddingPort = new FakeEmbeddingPort();
    const store = await buildFixtureVectorStore(embeddingPort);

    const queryEmbedding = await embeddingPort.embed('What is the weather on Mars?');
    const results = await store.search(queryEmbedding, { topK: 3, minScore: 0.3 });

    expect(results).toEqual([]);
  });
});
