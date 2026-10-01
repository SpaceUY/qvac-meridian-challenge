/**
 * Thrown when an embedding adapter returns a vector that doesn't match the
 * dimension established by the first vector it ever produced, or a vector
 * that isn't usable (empty, or containing non-finite numbers). Callers
 * should let this propagate rather than store the bad vector - a silently
 * wrong-dimension or NaN-poisoned entry breaks cosine similarity for every
 * later search against the store, not just this one.
 */
export class EmbeddingDimensionMismatchError extends Error {
  constructor(expected: number, received: number) {
    super(`Embedding dimension mismatch: expected ${expected}, received ${received}`);
    this.name = 'EmbeddingDimensionMismatchError';
  }
}

export class MalformedEmbeddingError extends Error {
  constructor(reason: string) {
    super(`Malformed embedding vector: ${reason}`);
    this.name = 'MalformedEmbeddingError';
  }
}
