import * as lancedb from '@lancedb/lancedb';
import type { VectorStorePort, VectorStoreWriterPort } from '../domain/ports.js';
import type { ChunkRecord, RetrievedChunk } from '../domain/types.js';
import { CHUNKS_TABLE } from '../../config/rag.config.js';

/**
 * One row of the `chunks` table. Deliberately FLAT - no nested objects.
 * LanceDB infers the Arrow schema from the first rows written, and a nested
 * `metadata` object would become a nested struct: harder to filter on and
 * more fragile across writes. `title`/`documentType` are stored as plain
 * columns and folded back into `RetrievedChunk.metadata` on the way out, so
 * this storage shape never leaks past this file.
 */
interface ChunkRow {
  id: string;
  vector: number[];
  content: string;
  source: string;
  chunkIndex: number;
  title: string;
  documentType: string;
  contentHash: string;
  /** Added by LanceDB on a vector query - not a stored column. */
  _distance: number;
}

/**
 * File-backed `VectorStorePort` over LanceDB. Read side only: the server
 * needs to search, not to write, and keeping the write API out of this
 * interface means an HTTP request path can't delete corpus chunks by
 * accident. Writing lives in `LanceDbVectorStoreWriter`, used by the ingest
 * CLI.
 *
 * Opened once and reused: `connect()`/`openTable()` are I/O, and the server
 * process is long-lived.
 */
export class LanceDbVectorStore implements VectorStorePort {
  private constructor(private readonly table: lancedb.Table) {}

  /** True if `dbDir` holds a table by this name - i.e. `npm run ingest` has run at least once. */
  static async exists(dbDir: string, tableName: string = CHUNKS_TABLE): Promise<boolean> {
    try {
      const db = await lancedb.connect(dbDir);
      return (await db.tableNames()).includes(tableName);
    } catch {
      // A missing/unreadable directory means "nothing ingested yet", which
      // is a normal first-run state, not an error the caller should handle.
      return false;
    }
  }

  /** Opens an existing table. Throws if it does not exist - check with `exists()` first. */
  static async open(dbDir: string, tableName: string = CHUNKS_TABLE): Promise<LanceDbVectorStore> {
    const db = await lancedb.connect(dbDir);
    return new LanceDbVectorStore(await db.openTable(tableName));
  }

  async search(
    embedding: number[],
    options: { topK: number; minScore: number }
  ): Promise<RetrievedChunk[]> {
    // `vectorSearch()`, not `search()`: `search()` also accepts a string for
    // full-text search, so it is typed `VectorQuery | Query | AutoQuery` and
    // would need a cast before `distanceType()`. `vectorSearch()` returns a
    // `VectorQuery` directly (verified in `dist/table.d.ts` of 0.39.0).
    const rows = (await this.table
      .vectorSearch(embedding)
      // Not LanceDB's default (l2). Cosine ignores vector magnitude, which
      // is what text embeddings need, AND it makes `score` below land on the
      // [-1, 1] similarity scale `RagRetrievalConfig.minScore` is expressed in.
      .distanceType('cosine')
      .limit(options.topK)
      .toArray()) as ChunkRow[];

    return rows
      .map(toRetrievedChunk)
      .filter((chunk) => chunk.score >= options.minScore);
  }
}

/**
 * The write side. Separate class from `LanceDbVectorStore` so the query
 * path never gets a handle that can delete.
 *
 * The table is created lazily, from the first batch of rows written:
 * LanceDB infers the Arrow schema - including the vector dimension - from
 * the data. `CorpusIngestService` checks that dimension against the
 * configured one before it ever gets here, so inference is safe.
 */
export class LanceDbVectorStoreWriter implements VectorStoreWriterPort {
  private table?: lancedb.Table;

  private constructor(
    private readonly db: lancedb.Connection,
    private readonly tableName: string
  ) {}

  static async open(dbDir: string, tableName: string = CHUNKS_TABLE): Promise<LanceDbVectorStoreWriter> {
    const db = await lancedb.connect(dbDir);
    const writer = new LanceDbVectorStoreWriter(db, tableName);
    if ((await db.tableNames()).includes(tableName)) {
      writer.table = await db.openTable(tableName);
    }
    return writer;
  }

  async replaceDocumentChunks(source: string, records: ChunkRecord[]): Promise<void> {
    const rows = records.map(toRow);

    // No table yet means nothing was ever ingested: create it from these
    // rows, so LanceDB infers the schema (vector width included) from real
    // data. There is nothing to delete in that case.
    if (!this.table) {
      if (rows.length > 0) this.table = await this.db.createTable(this.tableName, rows);
      return;
    }

    // Delete first, then add: a changed document can produce a different
    // number of chunks, so overwriting by id alone would strand the extras.
    await this.table.delete(sourceFilter(source));
    if (rows.length > 0) await this.table.add(rows);
  }

  async deleteDocumentChunks(source: string): Promise<void> {
    if (!this.table) return;
    await this.table.delete(sourceFilter(source));
  }

  async countRows(): Promise<number> {
    return this.table ? this.table.countRows() : 0;
  }

  async listDocumentHashes(): Promise<Map<string, string>> {
    const hashes = new Map<string, string>();
    if (!this.table) return hashes;

    // Two string columns only. LanceDB stores data column by column, so this
    // never reads the 768-float vectors. A plain `query()` has no default
    // limit (a vector search defaults to 10) - verified in `dist/query.d.ts`.
    const rows = (await this.table.query().select(['source', 'contentHash']).toArray()) as {
      source: string;
      contentHash: string;
    }[];

    for (const { source, contentHash } of rows) {
      const seen = hashes.get(source);
      hashes.set(source, seen === undefined || seen === contentHash ? contentHash : '');
    }
    return hashes;
  }
}

/** SQL predicate used by every delete/count by document. Single quotes are doubled, the SQL way to escape them, so a path containing one can't break the predicate. */
function sourceFilter(source: string): string {
  return `source = '${source.replaceAll("'", "''")}'`;
}

function toRow(record: ChunkRecord): Omit<ChunkRow, '_distance'> {
  return {
    id: record.id,
    vector: record.embedding,
    content: record.content,
    source: record.source,
    chunkIndex: record.chunkIndex,
    title: record.title,
    documentType: record.documentType,
    contentHash: record.contentHash
  };
}

/** LanceDB returns cosine DISTANCE (lower is better, range [0, 2]); `RetrievedChunk.score` is a SIMILARITY (higher is better). */
function toRetrievedChunk(row: ChunkRow): RetrievedChunk {
  return {
    id: row.id,
    content: row.content,
    score: 1 - row._distance,
    source: row.source,
    metadata: {
      title: row.title,
      documentType: row.documentType,
      chunkIndex: row.chunkIndex
    }
  };
}
