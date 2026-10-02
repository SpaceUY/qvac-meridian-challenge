import type { EmbeddingPort } from '../../domain/ports.js';

/**
 * Constant-vector `EmbeddingPort` for tests that exercise orchestration
 * (agent/voice wiring, cancellation, streaming) and don't care what gets
 * retrieved. Every text embeds to the same unit vector, so every fixture chunk
 * scores 1 against every query. Tests that assert on ranking or thresholds
 * must use `createRealEmbedding()` instead.
 */
export class StubEmbeddingPort implements EmbeddingPort {
  async embed(_text: string): Promise<number[]> {
    return [1, 0, 0, 0];
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0, 0]);
  }
}
