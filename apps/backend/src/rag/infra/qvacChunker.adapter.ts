import { ragChunk } from '@qvac/sdk';
import type { ChunkerPort } from '../domain/ports.js';
import { CHUNK_OPTIONS } from '../../config/rag.config.js';

/**
 * Backed by `ragChunk()`, one of the two primitives the challenge requires (the other is `embed()`) -
 * `ragIngest()`/`ragSearch()` are explicitly excluded. `ragChunk()` loads no model and owns no
 * connection, so it bypasses `ModelRuntimePort` on purpose instead of mixing a non-model concern into it.
 */
export class QvacChunker implements ChunkerPort {
  async chunk(document: string): Promise<string[]> {
    // ragChunk() returns Array<{ id, content }>, never bare strings.
    const chunks = await ragChunk({ documents: document, chunkOpts: CHUNK_OPTIONS });
    return chunks.map((chunk) => chunk.content);
  }
}
