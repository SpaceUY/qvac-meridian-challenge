export interface RetrievedChunk {
  id: string;
  content: string;
  score: number;
  source?: string;
  metadata?: Record<string, unknown>;
}

export interface RagRetrievalConfig {
  topK: number;
  minScore: number;
  maxContextChunks: number;
  dedupeExactContent: boolean;
}

/** Retrieval's output - `hasEvidence` lets callers (the graph's router, `ragDemo.ts`) branch without re-deriving it from `chunks.length`. */
export interface RagRetrievalResult {
  chunks: RetrievedChunk[];
  hasEvidence: boolean;
}

/**
 * One chunk as it is written to and read back from the vector store. Unlike
 * `RetrievedChunk` (the retrieval-time view, which carries a score and no
 * vector) this is the storage view: it carries the embedding and the
 * document-level `contentHash`.
 *
 * `source` is the document's path **relative to the corpus root** - the
 * value that ends up in a citation, and the key `VectorStoreWriterPort`
 * deletes by when a document is re-ingested.
 */
export interface ChunkRecord {
  /** `${source}#${chunkIndex}` - stable across re-ingests of unchanged content. */
  id: string;
  content: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
  /** Human-readable document name, surfaced in the grounded-context header. */
  title: string;
  /** Corpus top-level folder: 'reports', 'emails', 'policies', ... */
  documentType: string;
  /** SHA-256 of the WHOLE source document (not this chunk). This column IS the ingest state: the ingest compares it with the file on disk to decide whether to re-embed. */
  contentHash: string;
}
