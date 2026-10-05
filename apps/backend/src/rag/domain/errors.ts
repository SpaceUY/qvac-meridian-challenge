/** A wrong-dimension or NaN-poisoned vector must propagate, not be stored - it would break cosine similarity for every later search. */
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
