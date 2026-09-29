import type { RetrievedChunk } from '../domain/types.js';
import type { VectorStorePort } from '../domain/ports.js';

/** Store-internal representation only - never leaves `infra/`. Nothing outside this file should see a raw embedding vector. */
export interface IndexedChunk {
  id: string;
  content: string;
  embedding: number[];
  source?: string;
  metadata?: Record<string, unknown>;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Temporary/test infrastructure - validates the retrieval architecture and
 * ports without a real vector database. Holds every indexed chunk in
 * memory and scores by cosine similarity. Replace with a real local
 * adapter (e.g. `LanceDbVectorStore`) later without changing
 * `RagRetrievalService` or its callers.
 */
export class InMemoryVectorStore implements VectorStorePort {
  constructor(private readonly chunks: IndexedChunk[]) {}

  async search(
    embedding: number[],
    options: { topK: number; minScore: number }
  ): Promise<RetrievedChunk[]> {
    return this.chunks
      .map(
        (chunk): RetrievedChunk => ({
          id: chunk.id,
          content: chunk.content,
          score: cosineSimilarity(embedding, chunk.embedding),
          source: chunk.source,
          metadata: chunk.metadata
        })
      )
      .filter((chunk) => chunk.score >= options.minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, options.topK);
  }
}
