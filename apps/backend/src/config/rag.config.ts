import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RagRetrievalConfig } from '../rag/domain/types.js';

/** Every RAG tuning knob (chunking, retrieval sizing, rerank weights) lives in this file. */

const configDir = path.dirname(fileURLToPath(import.meta.url));
/** `src/config` -> `src` -> `backend` -> `apps` -> repo root. */
const repoRoot = path.resolve(configDir, '..', '..', '..', '..');

/**
 * Corpus root as shipped in `corpus.zip`. Every `source` stored in the
 * vector table is relative to THIS directory - the challenge requires
 * citations to carry corpus-relative paths ("reports/x.md", never
 * "corpus/reports/x.md" and never an absolute path), and this constant is
 * the single place that defines what "relative to the corpus root" means.
 */
export const CORPUS_ROOT = path.join(repoRoot, 'corpus');

/** File-backed LanceDB directory. Derived data: gitignored, rebuilt by `npm run ingest`. */
export const VECTOR_DB_DIR = path.join(repoRoot, '.lancedb');

export const CHUNKS_TABLE = 'chunks';

/** Text file extensions ingested from the corpus. `corpus/pictures/` is skipped: `ragChunk()` does not process binaries. */
export const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.html', '.json', '.csv']);

/**
 * `chunkSize`/`chunkOverlap` are in WORDS (`splitStrategy: 'word'`) - not
 * characters. Least-validated of the three tuned retrieval knobs: the size
 * sweep (90/180/270/360) ran before an embedding prefix fix and wasn't
 * repeated after.
 */
export const CHUNK_OPTIONS = {
  chunkSize: 180,
  chunkOverlap: 40,
  chunkStrategy: 'paragraph',
  splitStrategy: 'word'
} as const;

/**
 * Output dimension of `EMBEDDINGGEMMA_300M_Q4_0`, measured in Lab 3. The
 * challenge requires the store's vector dimension to match the embedding
 * model's; `CorpusIngestService` asserts the first real vector against this
 * number rather than trusting it, so a model swap fails loudly at ingest
 * instead of silently writing a table nothing can query.
 */
export const EMBEDDING_DIMENSIONS = 768;

/**
 * `topK` is the search pool feeding `metadataRerank()`, not the final
 * count - `maxContextChunks` is what reaches the LLM. `minScore` is a flat
 * 0.54 (no EN/ES routing exists) assuming `metadataRerank()` runs as a
 * second layer, not retrieval alone.
 */
export const DEFAULT_RAG_CONFIG: RagRetrievalConfig = {
  topK: 8,
  minScore: 0.54,
  maxContextChunks: 3,
  dedupeExactContent: true
};

/**
 * Tunable data for `metadataRerank()` (`../rag/service/metadataRerank.ts`).
 * `AUTHORITY_WEIGHT`/`SUPERSEDED_PENALTY` were tuned pre-embedding-prefix-fix
 * and not re-validated after - the post-fix holdout showed English Recall@3
 * drop from 100% to 92.3%.
 */
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
export const RERANK_CANDIDATE_POOL = 8;
/** Score bonus per authority tier above `informal-notes`. */
export const AUTHORITY_WEIGHT = 0.03;
/** Score penalty for a source listed in `SUPERSEDED_SOURCES`. */
export const SUPERSEDED_PENALTY = 0.05;

/** `documentType` (corpus top-level folder) -> authority label. No `pictures` entry: `ragChunk()` never processes binaries. */
export const AUTHORITY_BY_DOCUMENT_TYPE: Record<string, AuthorityLabel> = {
  policies: 'official-policy',
  data: 'system-of-record',
  emails: 'operational-email',
  reports: 'aggregated-report',
  faqs: 'internal-reference',
  transcripts: 'informal-notes'
};

/**
 * Corpus-relative `source` paths known to be superseded. Deliberately
 * empty: nothing in `corpus/` self-declares supersession, and guessing
 * would inject an unverified claim into grounded answers. Populate once
 * there's a real signal for it.
 */
export const SUPERSEDED_SOURCES: ReadonlySet<string> = new Set();
