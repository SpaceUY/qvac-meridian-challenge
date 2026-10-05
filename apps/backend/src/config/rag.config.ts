import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentType } from '../document/domain/document.model.js';
import type { RagRetrievalConfig } from '../rag/domain/types.js';

/** Every RAG tuning knob (chunking, retrieval sizing, rerank weights) lives in this file. */

const configDir = path.dirname(fileURLToPath(import.meta.url));
/** `src/config` -> `src` -> `backend` -> `apps` -> repo root. */
const repoRoot = path.resolve(configDir, '..', '..', '..', '..');

/** Every vector-table `source` is relative to this directory - the challenge requires corpus-relative citation paths ("reports/x.md", never absolute or `corpus/`-prefixed). */
export const CORPUS_ROOT = path.join(repoRoot, 'corpus');

/** File-backed LanceDB directory. Derived data: gitignored, rebuilt by `npm run ingest`. */
export const VECTOR_DB_DIR = path.join(repoRoot, '.lancedb');

export const CHUNKS_TABLE = 'chunks';

/** Text file extensions ingested from the corpus. `corpus/pictures/` is skipped: `ragChunk()` does not process binaries. */
export const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html', '.json', '.csv']);

/** Word-based (not character) chunk size/overlap - winner of a 90/180/270/360 sweep against the BGE-M3 retrieval benchmark (30-doc corpus, EN+ES, 13-question holdout). */
export const CHUNK_OPTIONS = {
  chunkSize: 180,
  chunkOverlap: 40,
  chunkStrategy: 'paragraph',
  splitStrategy: 'word'
} as const;

/** Must match `EMBEDDING_MODEL_SOURCE`'s output dimension; `CorpusIngestService` asserts the first real vector against this so a model swap fails loudly at ingest instead of writing an unqueryable table. Changing this needs a full reindex. */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * `topK` is the search pool feeding `metadataRerank()` (equal to `RERANK_CANDIDATE_POOL` so the reranker sees every candidate); `maxContextChunks` is what reaches the LLM and what the benchmark's "Recall@3" refers to.
 * `minScore` 0.551 is the pooled Youden's J optimum across EN+ES - same false-accept rate as the prior 0.57 but ~7pp more valid questions accepted.
 */
export const DEFAULT_RAG_CONFIG: RagRetrievalConfig = {
  topK: 15,
  minScore: 0.551,
  maxContextChunks: 3,
  dedupeExactContent: true
};

/** Longest text (UTF-16 chars) embedded per search - mirrors the frontend's `MAX_PROMPT_CHARS`, but enforced here too since API clients and voice transcripts bypass the composer. 700 stays well under the embedder's context limit even at one token/char. */
export const MAX_RETRIEVAL_QUERY_CHARS = 700;

/** Tunable data for `metadataRerank()` - re-tuned for BGE-M3 via a 120-combination sweep validated against a held-out 13-question set. */
export type AuthorityLabel =
  | 'official-policy'
  | 'official-reference'
  | 'operational-email'
  | 'system-of-record'
  | 'aggregated-report'
  | 'internal-reference'
  | 'informal-notes';

export const AUTHORITY_RANK: Record<AuthorityLabel, number> = {
  'official-policy': 4,
  'official-reference': 4,
  'operational-email': 3,
  'system-of-record': 3,
  'aggregated-report': 2,
  'internal-reference': 2,
  'informal-notes': 1
};

/** Top-ranked search candidates `metadataRerank()` reorders; the rest pass through untouched. */
export const RERANK_CANDIDATE_POOL = 15;
/** Score bonus per authority tier above `informal-notes`. */
export const AUTHORITY_WEIGHT = 0.02;
/** Score penalty for a source listed in `SUPERSEDED_SOURCES`. */
export const SUPERSEDED_PENALTY = 0.03;

/** `DocumentType` -> authority label. No `pictures` entry: `ragChunk()` never processes binaries. */
export const AUTHORITY_BY_DOCUMENT_TYPE: Record<string, AuthorityLabel> = {
  [DocumentType.POLICIES]: 'official-policy',
  [DocumentType.DATA]: 'system-of-record',
  [DocumentType.EMAIL]: 'operational-email',
  [DocumentType.REPORTS]: 'aggregated-report',
  [DocumentType.FAQ]: 'internal-reference',
  [DocumentType.TRANSCRIPT]: 'informal-notes'
};

/** Corpus-relative paths known to be superseded. Empty: nothing in `corpus/` self-declares supersession, and guessing would inject an unverified claim into answers. */
export const SUPERSEDED_SOURCES: ReadonlySet<string> = new Set();
