import { describe, expect, it } from 'vitest';
import type { EmbeddingPort, VectorStorePort } from '../domain/ports.js';
import type { RetrievedChunk } from '../domain/types.js';
import { RagRetrievalService } from './rag.service.js';

class FakeEmbedding implements EmbeddingPort {
  async embed(_text: string): Promise<number[]> {
    return [1];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1]);
  }
}

class FakeVectorStore implements VectorStorePort {
  public lastOptions: { topK: number; minScore: number } | undefined;

  constructor(private readonly results: RetrievedChunk[]) {}

  async search(_embedding: number[], options: { topK: number; minScore: number }): Promise<RetrievedChunk[]> {
    this.lastOptions = options;
    return this.results;
  }
}

describe('RagRetrievalService', () => {
  it('returns chunks from the store, preserving ranking order', async () => {
    const results: RetrievedChunk[] = [
      { id: 'a', content: 'Chunk A', score: 0.9 },
      { id: 'b', content: 'Chunk B', score: 0.8 }
    ];
    const service = new RagRetrievalService(new FakeEmbedding(), new FakeVectorStore(results), {
      topK: 5,
      minScore: 0.5,
      maxContextChunks: 5,
      dedupeExactContent: true
    });

    const result = await service.retrieve('a query');

    expect(result.chunks.map((c) => c.id)).toEqual(['a', 'b']);
    expect(result.hasEvidence).toBe(true);
  });

  it('passes topK and minScore from config into the store search', async () => {
    const store = new FakeVectorStore([]);
    const service = new RagRetrievalService(new FakeEmbedding(), store, {
      topK: 7,
      minScore: 0.42,
      maxContextChunks: 3,
      dedupeExactContent: true
    });

    await service.retrieve('a query');

    expect(store.lastOptions).toEqual({ topK: 7, minScore: 0.42 });
  });

  it('dedupes chunks with the same id, keeping the first (highest-ranked) occurrence', async () => {
    const results: RetrievedChunk[] = [
      { id: 'a', content: 'First label', score: 0.9 },
      { id: 'a', content: 'Duplicate id, different label', score: 0.8 },
      { id: 'b', content: 'Chunk B', score: 0.7 }
    ];
    const service = new RagRetrievalService(new FakeEmbedding(), new FakeVectorStore(results), {
      topK: 5,
      minScore: 0,
      maxContextChunks: 5,
      dedupeExactContent: true
    });

    const result = await service.retrieve('a query');

    expect(result.chunks).toEqual([
      { id: 'a', content: 'First label', score: 0.9 },
      { id: 'b', content: 'Chunk B', score: 0.7 }
    ]);
  });

  it('dedupes chunks with identical content when dedupeExactContent is true', async () => {
    const results: RetrievedChunk[] = [
      { id: 'a', content: 'Same content', score: 0.9 },
      { id: 'b', content: 'Same content', score: 0.8 }
    ];
    const service = new RagRetrievalService(new FakeEmbedding(), new FakeVectorStore(results), {
      topK: 5,
      minScore: 0,
      maxContextChunks: 5,
      dedupeExactContent: true
    });

    const result = await service.retrieve('a query');

    expect(result.chunks.map((c) => c.id)).toEqual(['a']);
  });

  it('keeps chunks with identical content when dedupeExactContent is false', async () => {
    const results: RetrievedChunk[] = [
      { id: 'a', content: 'Same content', score: 0.9 },
      { id: 'b', content: 'Same content', score: 0.8 }
    ];
    const service = new RagRetrievalService(new FakeEmbedding(), new FakeVectorStore(results), {
      topK: 5,
      minScore: 0,
      maxContextChunks: 5,
      dedupeExactContent: false
    });

    const result = await service.retrieve('a query');

    expect(result.chunks.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('caps results at maxContextChunks, preserving ranking order', async () => {
    const results: RetrievedChunk[] = [
      { id: 'a', content: 'A', score: 0.9 },
      { id: 'b', content: 'B', score: 0.8 },
      { id: 'c', content: 'C', score: 0.7 }
    ];
    const service = new RagRetrievalService(new FakeEmbedding(), new FakeVectorStore(results), {
      topK: 5,
      minScore: 0,
      maxContextChunks: 2,
      dedupeExactContent: true
    });

    const result = await service.retrieve('a query');

    expect(result.chunks.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('preserves source and metadata unchanged on each returned chunk', async () => {
    const chunk: RetrievedChunk = {
      id: 'a',
      content: 'Chunk A',
      score: 0.9,
      source: 'support-sla-faq.html',
      metadata: { documentType: 'FAQ', title: 'Support SLA - Internal FAQ' }
    };
    const service = new RagRetrievalService(new FakeEmbedding(), new FakeVectorStore([chunk]), {
      topK: 5,
      minScore: 0,
      maxContextChunks: 5,
      dedupeExactContent: true
    });

    const result = await service.retrieve('a query');

    expect(result.chunks[0]).toEqual(chunk);
  });

  it('returns hasEvidence: false and an empty chunk list when the store finds nothing', async () => {
    const service = new RagRetrievalService(new FakeEmbedding(), new FakeVectorStore([]), {
      topK: 5,
      minScore: 0.5,
      maxContextChunks: 4,
      dedupeExactContent: true
    });

    const result = await service.retrieve('a query with no matches');

    expect(result).toEqual({ chunks: [], hasEvidence: false });
  });
});
