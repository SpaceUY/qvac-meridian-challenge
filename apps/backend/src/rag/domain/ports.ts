import type { RetrievedChunk } from './types.js';

export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
}

export interface VectorStorePort {
  search(
    embedding: number[],
    options: { topK: number; minScore: number }
  ): Promise<RetrievedChunk[]>;
}
