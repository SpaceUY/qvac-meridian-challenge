import * as lancedb from '@lancedb/lancedb';
import type { VectorStorePort, VectorStoreWriterPort } from '../domain/ports.js';
import type { ChunkRecord, RetrievedChunk } from '../domain/types.js';
import { CHUNKS_TABLE } from '../../config/rag.config.js';

/** Deliberately flat (no nested `metadata`) - LanceDB infers the Arrow schema from the first write, and a nested object becomes a harder-to-filter struct. Folded back into `RetrievedChunk.metadata` on the way out. */
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

/** Read side only - keeping write out of this interface means a request path can't delete corpus chunks by accident. Writing lives in `LanceDbVectorStoreWriter` (ingest CLI only). */
export class LanceDbVectorStore implements VectorStorePort {
  private constructor(private readonly table: lancedb.Table) {}

  /** True if `dbDir` holds a table by this name - i.e. `npm run ingest` has run at least once. */
  static async exists(dbDir: string, tableName: string = CHUNKS_TABLE): Promise<boolean> {
    try {
      const db = await lancedb.connect(dbDir);
      return (await db.tableNames()).includes(tableName);
    } catch {
      // Missing/unreadable dir just means nothing ingested yet.
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
    // vectorSearch() (not search(), which is typed for text search too and needs a cast before distanceType()).
    const rows = (await this.table
      .vectorSearch(embedding)
      // cosine, not LanceDB's default l2: ignores magnitude and matches the [-1,1] scale minScore expects.
      .distanceType('cosine')
      .limit(options.topK)
      .toArray()) as ChunkRow[];

    return rows
      .map(toRetrievedChunk)
      .filter((chunk) => chunk.score >= options.minScore);
  }
}

/** Separate class from `LanceDbVectorStore` so the query path never gets a handle that can delete. Table is created lazily from the first write so LanceDB infers the Arrow schema/vector dimension from real data. */
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

    if (!this.table) {
      if (rows.length > 0) this.table = await this.db.createTable(this.tableName, rows);
      return;
    }

    // Delete then add: a changed document can produce a different chunk count, so overwrite-by-id would strand extras.
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

    // Columnar store, so selecting only these two columns never reads the vectors; plain query() has no row limit (unlike vectorSearch's default 10).
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
