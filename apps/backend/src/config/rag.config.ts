import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DocumentType } from '../document/domain/document.model.js';
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
 * characters. Re-validated as part of the BGE-M3 retrieval benchmark (30-doc
 * real corpus, EN+ES, 13-question holdout): these two values were already
 * the sweep's winner (90/180/270/360 tested) and carry over unchanged.
 */
export const CHUNK_OPTIONS = {
  chunkSize: 180,
  chunkOverlap: 40,
  chunkStrategy: 'paragraph',
  splitStrategy: 'word'
} as const;

/**
 * Output dimension of `EMBEDDING_MODEL_SOURCE` (BGE-M3, see
 * `models.config.ts`). The challenge requires the store's vector dimension
 * to match the embedding model's; `CorpusIngestService` asserts the first
 * real vector against this number rather than trusting it, so a model swap
 * fails loudly at ingest instead of silently writing a table nothing can
 * query. Changing this value alone does nothing to existing data - a full
 * reindex is required, see `EMBEDDING_MODEL_SOURCE`'s doc comment.
 */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * `topK` is the search pool feeding `metadataRerank()`, not the final
 * count - `maxContextChunks` is what reaches the LLM (the benchmark's own
 * "topK/Recall@3" figures refer to this, `maxContextChunks`, not the search
 * pool below). `topK` here is set equal to `RERANK_CANDIDATE_POOL` so the
 * reranker always sees every retrieved candidate - a lower `topK` would
 * starve `RERANK_CANDIDATE_POOL` of candidates it could otherwise rerank.
 * `minScore` is a flat 0.551 - the pooled Youden's J optimum across EN+ES,
 * assuming a downstream LLM guardrail that can say "I don't know" rather
 * than hallucinate on weak context. It strictly dominates the previously
 * used 0.57: identical false-accept rate (16.7%) in both languages, but
 * accepts ~7pp more valid questions in each. Applied uniformly since this
 * codebase has no EN/ES query-language routing today.
 */
export const DEFAULT_RAG_CONFIG: RagRetrievalConfig = {
  topK: 15,
  minScore: 0.551,
  maxContextChunks: 3,
  dedupeExactContent: true
};

/**
 * Longest text, in UTF-16 characters, embedded for one retrieval search -
 * see `toRetrievalQuery()` (`rag/service/retrievalQuery.ts`). Mirrors the
 * frontend composer's `MAX_PROMPT_CHARS` (`apps/frontend/src/lib/prompt-limit.ts`);
 * the backend still clips on its own because API clients and voice
 * transcripts never pass through that composer. A message pasted whole
 * (tens of thousands of characters) overflows the embedder's context and
 * fails the turn; 700 characters stay far below it even at one token per
 * character.
 */
export const MAX_RETRIEVAL_QUERY_CHARS = 700;

/**
 * Tunable data for `metadataRerank()` (`../rag/service/metadataRerank.ts`).
 * Re-tuned specifically for BGE-M3 (120-combination sweep, validated against
 * a 13-question holdout never used to pick the weights) - see
 * `EMBEDDING_MODEL_SOURCE` in `models.config.ts` for the full benchmark
 * context.
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

/**
 * Corpus-relative `source` paths known to be superseded. Deliberately
 * empty: nothing in `corpus/` self-declares supersession, and guessing
 * would inject an unverified claim into grounded answers. Populate once
 * there's a real signal for it.
 */
export const SUPERSEDED_SOURCES: ReadonlySet<string> = new Set();
