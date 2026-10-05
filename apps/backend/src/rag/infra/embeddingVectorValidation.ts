import { EmbeddingDimensionMismatchError, MalformedEmbeddingError } from '../domain/errors.js';

/** Shared with `QvacEmbeddingService`'s validation so `NativeEmbeddingProvider` enforces the same contract without duplicating it; each call gets its own tracked dimension via closure. */
export function createEmbeddingVectorValidator(): (vector: number[]) => number[] {
  let dimension: number | undefined;

  return (vector: number[]): number[] => {
    if (vector.length === 0 || !vector.every((value) => Number.isFinite(value))) {
      throw new MalformedEmbeddingError(vector.length === 0 ? 'empty vector' : 'non-finite value in vector');
    }

    if (dimension === undefined) {
      dimension = vector.length;
    } else if (vector.length !== dimension) {
      throw new EmbeddingDimensionMismatchError(dimension, vector.length);
    }

    return vector;
  };
}
