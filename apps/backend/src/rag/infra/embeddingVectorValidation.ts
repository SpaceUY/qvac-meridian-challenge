import { EmbeddingDimensionMismatchError, MalformedEmbeddingError } from '../domain/errors.js';

/**
 * Same validation `QvacEmbeddingService` applies to every SDK-path vector
 * (its private `validate()`) - factored out here so `NativeEmbeddingProvider`
 * enforces the identical contract (reject empty/non-finite vectors, lock the
 * expected dimension from the first real vector) without duplicating the
 * error-throwing logic. Each call site gets its own independent tracked
 * dimension via the closure this returns, matching `QvacEmbeddingService`'s
 * own per-instance `this.dimension` field - two providers never share state.
 */
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
