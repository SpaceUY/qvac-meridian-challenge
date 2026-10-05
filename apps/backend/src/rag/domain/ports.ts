import type { ChunkRecord, RetrievedChunk } from './types.js';

export interface EmbeddingPort {
  embed(text: string): Promise<number[]>;
  /** One vector per input, in input order. Separate from `embed()` since the real adapter is one RPC round trip per call - batching avoids N trips for N chunks. */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface VectorStorePort {
  search(
    embedding: number[],
    options: { topK: number; minScore: number }
  ): Promise<RetrievedChunk[]>;
}

/** Write side of the vector store, kept apart from `VectorStorePort` so the query path can't delete corpus data - only the ingest CLI depends on this. No `upsert`: a changed document can produce a different chunk count, so `replaceDocumentChunks` always deletes-then-re-adds by `source` instead of stranding extra keyed rows. */
export interface VectorStoreWriterPort {
  /** Drops every chunk whose `source` matches, then writes `records`; an empty `records` is just a delete. */
  replaceDocumentChunks(source: string, records: ChunkRecord[]): Promise<void>;
  deleteDocumentChunks(source: string): Promise<void>;
  countRows(): Promise<number>;
  /** `source` -> `contentHash` for every document in the table - this table IS the ingest state. */
  listDocumentHashes(): Promise<Map<string, string>>;
}

/** Behind a port because the real implementation is an RPC into the QVAC worker - lets `CorpusIngestService` be tested with a trivial splitter. */
export interface ChunkerPort {
  chunk(document: string): Promise<string[]>;
}
