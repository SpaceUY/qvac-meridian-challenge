import type { RetrievedChunk } from '../domain/types.js';

function formatHeader(chunk: RetrievedChunk): string {
  const parts: string[] = [];
  if (chunk.source) parts.push(`Source: ${chunk.source}`);
  parts.push(`id: ${chunk.id}`);

  const title = chunk.metadata?.title;
  if (typeof title === 'string' && title.length > 0) parts.push(`title: ${title}`);

  return `[${parts.join(' | ')}]`;
}

/**
 * Formats retrieved chunks into the grounded context block injected into
 * the system prompt. The only place that knows this text format - kept
 * separate from `RagRetrievalService` so context/citation formatting can
 * evolve independently of retrieval.
 */
export function buildGroundedContext(chunks: RetrievedChunk[]): string {
  return chunks.map((chunk) => `${formatHeader(chunk)}\n${chunk.content}`).join('\n\n');
}
