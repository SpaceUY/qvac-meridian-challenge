import type { EmbeddingPort } from '../../domain/ports.js';

/** Constant-vector `EmbeddingPort` for tests that don't care what gets retrieved - every query scores 1 against every chunk. Tests asserting on ranking/thresholds need `createRealEmbedding()` instead. */
export class StubEmbeddingPort implements EmbeddingPort {
  async embed(_text: string): Promise<number[]> {
    return [1, 0, 0, 0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0, 0]);
  }
}
