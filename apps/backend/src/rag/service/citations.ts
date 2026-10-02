import type { Citation, CitedChunk, RetrievedChunk } from '../domain/types.js';

/** Enough to rank and to compare runs, without float noise like 0.8312345678. */
const SCORE_DECIMALS = 4;

/**
 * Chunks -> citations: one entry per source DOCUMENT, not per chunk. Three
 * chunks of the same file are one citation carrying that file's best
 * score. Sorted best-first, ties broken by path, so the same retrieval
 * always yields the same array (deterministic runs, req. [6.1.3]).
 * Chunks without a `source` are skipped: a citation needs a file.
 *
 * Deciding WHETHER to cite at all (e.g. the model answered "not enough
 * information") is not this function's job - see `selectCitations` in
 * `ai/orchestrator/citationPolicy.ts`.
 */
export function toCitations(chunks: RetrievedChunk[]): Citation[] {
  const bestScoreByFile = new Map<string, number>();
  for (const chunk of chunks) {
    if (!chunk.source) continue;
    const seen = bestScoreByFile.get(chunk.source);
    if (seen === undefined || chunk.score > seen) bestScoreByFile.set(chunk.source, chunk.score);
  }

  return [...bestScoreByFile]
    .map(([file, score]) => ({ file, score: roundScore(score) }))
    .sort((a, b) => b.score - a.score || comparePaths(a.file, b.file));
}

/**
 * The passages behind `citations`: every retrieved chunk of a cited file,
 * grouped in citation order, best chunk first within a file (ties by id, so
 * the order is deterministic). Driven by `citations`, not by `chunks`, so
 * whatever `selectCitations` decided not to cite - including everything,
 * for a "not enough information" answer - ships no text either.
 */
export function toCitedChunks(chunks: RetrievedChunk[], citations: Citation[]): CitedChunk[] {
  return citations.flatMap(({ file }) =>
    chunks
      .filter((chunk) => chunk.source === file)
      .sort((a, b) => b.score - a.score || comparePaths(a.id, b.id))
      .map((chunk) => toCitedChunk(file, chunk))
  );
}

function toCitedChunk(file: string, chunk: RetrievedChunk): CitedChunk {
  const chunkIndex = chunk.metadata?.chunkIndex;
  return {
    file,
    ...(typeof chunkIndex === 'number' ? { chunkIndex } : {}),
    score: roundScore(chunk.score),
    content: chunk.content
  };
}

function roundScore(score: number): number {
  const factor = 10 ** SCORE_DECIMALS;
  return Math.round(score * factor) / factor;
}

/** Plain code-unit order, not `localeCompare`: the result must not depend on the machine's locale. */
function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
