import type { RetrievedChunk } from '../domain/types.js';

function formatHeader(chunk: RetrievedChunk): string {
  const parts: string[] = [];
  if (chunk.source) parts.push(`Source: ${chunk.source}`);
  parts.push(`id: ${chunk.id}`);

  const title = chunk.metadata?.title;
  if (typeof title === 'string' && title.length > 0) parts.push(`title: ${title}`);

  const authority = chunk.metadata?.authority;
  if (typeof authority === 'string' && authority.length > 0) parts.push(`authority: ${authority}`);

  const status = chunk.metadata?.status;
  if (typeof status === 'string' && status.length > 0) parts.push(`status: ${status}`);

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
