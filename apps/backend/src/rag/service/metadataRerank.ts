import {
  AUTHORITY_BY_DOCUMENT_TYPE,
  AUTHORITY_RANK,
  AUTHORITY_WEIGHT,
  RERANK_CANDIDATE_POOL,
  SUPERSEDED_PENALTY,
  SUPERSEDED_SOURCES,
  type AuthorityLabel
} from '../../config/rag.config.js';
import type { RetrievedChunk } from '../domain/types.js';

/** Deterministic reorder by document authority + supersession penalty - not an ML reranker. Tunable weights live in `rag.config.ts`. */

const DEFAULT_AUTHORITY: AuthorityLabel = 'informal-notes';

function authorityFor(chunk: RetrievedChunk): AuthorityLabel {
  const documentType = chunk.metadata?.documentType;
  if (typeof documentType !== 'string') return DEFAULT_AUTHORITY;
  return AUTHORITY_BY_DOCUMENT_TYPE[documentType] ?? DEFAULT_AUTHORITY;
}

function isSuperseded(chunk: RetrievedChunk): boolean {
  return chunk.source !== undefined && SUPERSEDED_SOURCES.has(chunk.source);
}

/** Reorders the top `RERANK_CANDIDATE_POOL` chunks (expected pre-sorted by `score`) by `score + authority bonus - superseded penalty`; `score` itself is untouched. */
export function metadataRerank(chunks: RetrievedChunk[]): RetrievedChunk[] {
  const pool = chunks.slice(0, RERANK_CANDIDATE_POOL);
  const rest = chunks.slice(RERANK_CANDIDATE_POOL);

  const annotated = pool.map((chunk) => {
    const authority = authorityFor(chunk);
    const superseded = isSuperseded(chunk);
    const bonus = AUTHORITY_WEIGHT * (AUTHORITY_RANK[authority] - 1);
    const penalty = superseded ? SUPERSEDED_PENALTY : 0;

    return {
      adjustedScore: chunk.score + bonus - penalty,
      chunk: {
        ...chunk,
        metadata: {
          ...chunk.metadata,
          authority,
          status: superseded ? 'superseded' : 'current'
        }
      }
    };
  });

  annotated.sort((a, b) => b.adjustedScore - a.adjustedScore);

  return [...annotated.map((entry) => entry.chunk), ...rest];
}
