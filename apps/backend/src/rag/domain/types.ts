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

/** Retrieval's output - `hasEvidence` lets callers (the graph's router) branch without re-deriving it from `chunks.length`. */
export interface RagRetrievalResult {
  chunks: RetrievedChunk[];
  hasEvidence: boolean;
}

/** Storage view of a chunk (unlike `RetrievedChunk`, carries the embedding + document-level `contentHash`). `source` is the corpus-relative path used in citations and as the re-ingest delete key. */
export interface ChunkRecord {
  /** `${source}#${chunkIndex}` - stable across re-ingests of unchanged content. */
  id: string;
  content: string;
  embedding: number[];
  source: string;
  chunkIndex: number;
  /** Human-readable document name, surfaced in the grounded-context header. */
  title: string;
  /** A `DocumentType` value ('REPORTS', 'EMAIL', 'POLICIES', ...), derived from the corpus top-level folder. */
  documentType: string;
  /** SHA-256 of the whole source document (not this chunk) - compared against disk to decide whether to re-embed. */
  contentHash: string;
}

/** Shape fixed by the QVAC evaluator's `choices[].message.citations` contract - no extra fields. */
export interface Citation {
  file: string;
  score: number;
}
