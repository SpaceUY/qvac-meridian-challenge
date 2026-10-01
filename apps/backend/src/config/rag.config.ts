import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
 * Chunking options passed to `ragChunk()`. `chunkSize: 600` was chosen in
 * Lab 4 after comparing 150 / 600 / 2000 against the real corpus - 150 gave
 * a BETTER raw distance score but all 3 top results came from the same
 * document (the winning phrase cut mid-sentence); 600 gave the 3 top
 * results from 3 different files, a more useful answer even at a worse
 * score. A qualitative choice, backed by one measured comparison - not yet
 * validated with a `recall@k` sweep across the full `preguntas-eval.json`
 * set - that sweep is future work, not covered by this plan.
 */
export const CHUNK_OPTIONS = {
  chunkSize: 600,
  chunkOverlap: 100,
  chunkStrategy: 'paragraph',
  splitStrategy: 'character'
} as const;

/**
 * Output dimension of `EMBEDDINGGEMMA_300M_Q4_0`, measured in Lab 3. The
 * challenge requires the store's vector dimension to match the embedding
 * model's; `CorpusIngestService` asserts the first real vector against this
 * number rather than trusting it, so a model swap fails loudly at ingest
 * instead of silently writing a table nothing can query.
 */
export const EMBEDDING_DIMENSIONS = 768;
