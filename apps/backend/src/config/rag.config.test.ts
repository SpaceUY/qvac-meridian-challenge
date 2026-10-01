import { describe, expect, it } from 'vitest';
import { AUTHORITY_RANK, DEFAULT_RAG_CONFIG, SUPERSEDED_SOURCES } from './rag.config.js';

describe('DEFAULT_RAG_CONFIG', () => {
  it('documents the tuned defaults from the retrieval eval sweep', () => {
    expect(DEFAULT_RAG_CONFIG).toEqual({
      topK: 15,
      minScore: 0.551,
      maxContextChunks: 3,
      dedupeExactContent: true
    });
  });
});

describe('AUTHORITY_RANK', () => {
  it('ranks official sources above everything else, and informal notes lowest', () => {
    expect(AUTHORITY_RANK['official-policy']).toBeGreaterThan(AUTHORITY_RANK['operational-email']);
    expect(AUTHORITY_RANK['operational-email']).toBeGreaterThan(AUTHORITY_RANK['aggregated-report']);
    expect(AUTHORITY_RANK['aggregated-report']).toBeGreaterThan(AUTHORITY_RANK['informal-notes']);
  });
});

describe('SUPERSEDED_SOURCES', () => {
  it('ships empty - no source in the corpus self-declares supersession today', () => {
    expect(SUPERSEDED_SOURCES.size).toBe(0);
  });
});
