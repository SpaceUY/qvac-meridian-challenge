import type { EmbeddingPort } from '../domain/ports.js';

const VECTOR_DIMENSIONS = 256;

const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'to', 'of', 'in', 'on',
  'for', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those', 'it', 'its',
  'as', 'at', 'by', 'with', 'from', 'about', 'into', 'over', 'after', 'before', 'during', 'what',
  'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'do', 'does', 'did', 'can', 'could',
  'should', 'would', 'will', 'shall', 'may', 'might', 'not', 'no', 'yes', 'we', 'you', 'they',
  'he', 'she', 'i', 'our', 'your'
]);

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.filter((word) => !STOPWORDS.has(word));
}

function hashToken(token: string): number {
  let hash = 0;
  for (let i = 0; i < token.length; i++) {
    hash = (hash * 31 + token.charCodeAt(i)) >>> 0;
  }
  return hash % VECTOR_DIMENSIONS;
}

/**
 * Temporary/test infrastructure - validates the retrieval architecture and
 * ports without a real embedding model. Deterministic hashed bag-of-words:
 * tokenize (stopwords removed), accumulate term frequency into a
 * fixed-size vector via the hashing trick, L2-normalize. No network calls,
 * no model downloads. Replace with a real local embedding adapter later
 * without changing `RagRetrievalService` or its callers.
 */
export class FakeEmbeddingPort implements EmbeddingPort {
  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(VECTOR_DIMENSIONS).fill(0);
    for (const token of tokenize(text)) {
      vector[hashToken(token)] += 1;
    }

    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm === 0) return vector;

    return vector.map((value) => value / norm);
  }
}
