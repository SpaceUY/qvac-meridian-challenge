import type { RagRetrievalConfig } from '../domain/types.js';

/**
 * Initial defaults, not tuned/optimal values - all three are meant to be
 * overridden per deployment/corpus once real embeddings and a real corpus
 * are in place.
 */
export const DEFAULT_RAG_CONFIG: RagRetrievalConfig = {
  topK: 5,
  minScore: 0.65,
  maxContextChunks: 4,
  dedupeExactContent: true
};
