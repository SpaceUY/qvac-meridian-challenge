import { describe, expect, it } from 'vitest';
import { DEFAULT_RAG_CONFIG } from './rag.service.const.js';

describe('DEFAULT_RAG_CONFIG', () => {
  it('documents the initial tunable defaults from the task spec', () => {
    expect(DEFAULT_RAG_CONFIG).toEqual({
      topK: 5,
      minScore: 0.65,
      maxContextChunks: 4,
      dedupeExactContent: true
    });
  });
});
