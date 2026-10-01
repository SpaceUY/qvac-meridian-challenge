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
