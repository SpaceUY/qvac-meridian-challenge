import type { RetrievedChunk } from './types.js';

export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
  /** Embeds multiple texts (e.g. document chunks being ingested) using the same model as `embed()`. */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface VectorStorePort {
  search(
    embedding: number[],
    options: { topK: number; minScore: number }
  ): Promise<RetrievedChunk[]>;
}
