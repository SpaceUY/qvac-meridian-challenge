import { ragChunk } from '@qvac/sdk';
import type { ChunkerPort } from '../domain/ports.js';
import { CHUNK_OPTIONS } from '../../config/rag.config.js';

/**
 * Real `ChunkerPort`, backed by the SDK's `ragChunk()` primitive - one of
 * the two primitives the challenge requires this store to be populated
 * through (the other is `embed()`). `ragIngest()`/`ragSearch()` are
 * explicitly excluded by the challenge and are not used anywhere.
 *
 * The only file in the `rag` feature that imports `@qvac/sdk`, on purpose:
 * `ragChunk()` takes no `modelId`, loads nothing and owns no connection
 * lifecycle (verified against `dist/client/api/rag.d.ts`), so it is a text
 * primitive rather than a model operation, and routing it through
 * `ModelRuntimePort` would put a non-model concern in a model-runtime port.
 * `close()` is still owned solely by `ModelManagementService`.
 */
export class QvacChunker implements ChunkerPort {
  async chunk(document: string): Promise<string[]> {
    // `ragChunk()` always returns `Array<{ id, content }>` - never bare
    // strings, never `{ chunks: [...] }`. Verified against the installed
    // package before writing this (a wrong guess here cost a bug in Lab 4).
    const chunks = await ragChunk({ documents: document, chunkOpts: CHUNK_OPTIONS });
    return chunks.map((chunk) => chunk.content);
  }
}
