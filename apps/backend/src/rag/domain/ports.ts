import type { ChunkRecord, RetrievedChunk } from './types.js';

export interface EmbeddingPort {
  /** Embeds a single text - the query side of retrieval. */
  embed(text: string): Promise<number[]>;
  /**
   * Embeds many texts at once, returning one vector per input **in input
   * order** - the ingestion side. Separate from `embed()` because the real
   * adapter sends one RPC round trip per call: embedding 100 chunks one by
   * one costs 100 trips, batching costs one.
   */
  embedBatch(texts: string[]): Promise<number[][]>;
}

export interface VectorStorePort {
  search(
    embedding: number[],
    options: { topK: number; minScore: number }
  ): Promise<RetrievedChunk[]>;
}

/**
 * The write side of the vector store, kept apart from `VectorStorePort` so
 * the query path (server, graph) cannot delete corpus data - only the
 * ingest CLI depends on this interface.
 *
 * There is no `upsert`: `replaceDocumentChunks` deletes by `source` and
 * re-adds, because a changed document can produce a different NUMBER of
 * chunks, and a key-based upsert would strand the extra ones.
 */
export interface VectorStoreWriterPort {
  /** Atomically-intended replace: drops every chunk whose `source` matches, then writes `records`. Passing an empty `records` is just a delete. */
  replaceDocumentChunks(source: string, records: ChunkRecord[]): Promise<void>;
  /** Drops every chunk of a document - used for files removed from the corpus. */
  deleteDocumentChunks(source: string): Promise<void>;
  countRows(): Promise<number>;
  /**
   * `source` -> `contentHash` of every document currently in the table. This
   * IS the ingest state: a document counts as ingested exactly when its rows
   * are here with a matching hash, so there is no second record that could
   * disagree with the data. `''` marks a document whose rows carry different
   * hashes (should never happen) - it matches nothing, so it gets re-embedded.
   */
  listDocumentHashes(): Promise<Map<string, string>>;
}

/**
 * Splits a whole document into chunk texts, in document order. Behind a
 * port because the real implementation is an RPC into the QVAC worker: this
 * lets `CorpusIngestService` be tested with a trivial splitter, with no
 * worker and no model.
 */
export interface ChunkerPort {
  chunk(document: string): Promise<string[]>;
}
