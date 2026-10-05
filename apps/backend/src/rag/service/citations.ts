import type { Citation, RetrievedChunk } from '../domain/types.js';

/** Enough to rank and to compare runs, without float noise like 0.8312345678. */
const SCORE_DECIMALS = 4;

/**
 * Chunks -> citations: one entry per source document (not per chunk), carrying its best score. Sorted
 * best-first, ties broken by path, for deterministic runs (req. [6.1.3]). Whether to cite at all is
 * `selectCitations` in `ai/orchestrator/citationPolicy.ts`, not here.
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

function roundScore(score: number): number {
  const factor = 10 ** SCORE_DECIMALS;
  return Math.round(score * factor) / factor;
}

/** Plain code-unit order, not `localeCompare`: the result must not depend on the machine's locale. */
function comparePaths(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
