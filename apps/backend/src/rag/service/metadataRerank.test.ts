import { describe, expect, it } from 'vitest';
import { AUTHORITY_WEIGHT, RERANK_CANDIDATE_POOL, SUPERSEDED_SOURCES } from '../../config/rag.config.js';
import { DocumentType } from '../../document/domain/document.model.js';
import type { RetrievedChunk } from '../domain/types.js';
import { metadataRerank } from './metadataRerank.js';

function chunk(id: string, score: number, documentType?: string): RetrievedChunk {
  return {
    id,
    content: `content for ${id}`,
    score,
    source: `${id}.md`,
    ...(documentType ? { metadata: { documentType } } : {})
  };
}

describe('metadataRerank', () => {
  it('promotes a lower-score policy chunk above a higher-score transcript chunk', () => {
    const chunks = [chunk('transcript', 0.7, DocumentType.TRANSCRIPT), chunk('policy', 0.68, DocumentType.POLICIES)];

    const result = metadataRerank(chunks);

    expect(result.map((c) => c.id)).toEqual(['policy', 'transcript']);
  });

  it('does not reorder chunks whose authority-adjusted scores keep the same relative order', () => {
    const chunks = [chunk('a', 0.9, DocumentType.POLICIES), chunk('b', 0.8, DocumentType.POLICIES)];

    const result = metadataRerank(chunks);

    expect(result.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('defaults to the lowest authority tier when documentType is missing or unrecognized', () => {
    const chunks = [chunk('known', 0.5, DocumentType.POLICIES), chunk('unknown', 0.5, 'some-unmapped-type'), chunk('missing', 0.5)];

    const result = metadataRerank(chunks);

    expect(result[0].id).toBe('known');
    expect(result[1].metadata?.authority).toBe('informal-notes');
    expect(result[2].metadata?.authority).toBe('informal-notes');
  });

  it('annotates every reordered chunk with authority and status, leaving score untouched', () => {
    const chunks = [chunk('a', 0.9, DocumentType.POLICIES)];

    const result = metadataRerank(chunks);

    expect(result[0]).toMatchObject({
      score: 0.9,
      metadata: { documentType: DocumentType.POLICIES, authority: 'official-policy', status: 'current' }
    });
  });

  it('applies the authority bonus consistently with AUTHORITY_WEIGHT', () => {
    const chunks = [chunk('policy', 0.5, DocumentType.POLICIES), chunk('transcript', 0.5 + 3 * AUTHORITY_WEIGHT + 0.001, DocumentType.TRANSCRIPT)];

    const result = metadataRerank(chunks);

    expect(result.map((c) => c.id)).toEqual(['transcript', 'policy']);
  });

  it('leaves chunks beyond RERANK_CANDIDATE_POOL untouched, in their original order', () => {
    const pool = Array.from({ length: RERANK_CANDIDATE_POOL }, (_, i) => chunk(`pool-${i}`, 1 - i * 0.01, DocumentType.TRANSCRIPT));
    const overflow = [chunk('overflow-low-authority', 0.1, DocumentType.TRANSCRIPT), chunk('overflow-high-authority', 0.05, DocumentType.POLICIES)];

    const result = metadataRerank([...pool, ...overflow]);

    expect(result.slice(RERANK_CANDIDATE_POOL).map((c) => c.id)).toEqual([
      'overflow-low-authority',
      'overflow-high-authority'
    ]);
    expect(result.slice(RERANK_CANDIDATE_POOL)[0].metadata?.authority).toBeUndefined();
  });

  it('marks every chunk as "current" today, since SUPERSEDED_SOURCES has no entries yet', () => {
    expect(SUPERSEDED_SOURCES.size).toBe(0);

    const result = metadataRerank([chunk('a', 0.9, DocumentType.REPORTS)]);

    expect(result[0].metadata?.status).toBe('current');
  });
});
