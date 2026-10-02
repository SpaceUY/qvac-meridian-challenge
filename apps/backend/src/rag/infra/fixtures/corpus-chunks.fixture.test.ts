import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_RAG_CONFIG } from '../../../config/rag.config.js';
import type { LanceDbVectorStore } from '../lanceDbVectorStore.js';
import { buildFixtureVectorStore } from './corpus-chunks.fixture.js';
import { createRealEmbedding, isEmbeddingModelCached, type RealEmbedding } from './realEmbedding.testSupport.js';

describe.skipIf(!isEmbeddingModelCached())('corpus-chunks fixtures + LanceDbVectorStore + real embeddings', () => {
  let embedding: RealEmbedding;
  let store: LanceDbVectorStore;

  beforeAll(async () => {
    embedding = createRealEmbedding();
    store = await buildFixtureVectorStore(embedding.embeddingPort);
  }, 120_000);

  afterAll(async () => {
    await embedding.dispose();
  });

  it('ranks the matching chunk highest and clears the default minScore for an on-topic query', async () => {
    const queryEmbedding = await embedding.embeddingPort.embed('What is the enterprise P1 first response SLA?');
    const results = await store.search(queryEmbedding, { topK: 3, minScore: DEFAULT_RAG_CONFIG.minScore });

    expect(results[0].id).toBe('chunk-sla-p1');
    expect(results[0].source).toBe('support-sla-faq.html');
  });

  it('returns nothing for an off-topic query at the same threshold', async () => {
    const queryEmbedding = await embedding.embeddingPort.embed('What is the weather on Mars?');
    const results = await store.search(queryEmbedding, { topK: 3, minScore: DEFAULT_RAG_CONFIG.minScore });

    expect(results).toEqual([]);
  });
});
