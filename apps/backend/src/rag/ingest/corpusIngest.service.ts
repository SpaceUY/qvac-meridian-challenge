import type { ChunkerPort, EmbeddingPort, VectorStoreWriterPort } from '../domain/ports.js';
import type { ChunkRecord } from '../domain/types.js';
import { EMBEDDING_DIMENSIONS } from '../../config/rag.config.js';
import { readCorpus, type CorpusDocument } from './corpusReader.js';

/** What one ingest run did, per document. Printed by the CLI and asserted by tests. */
export interface IngestReport {
  /** Documents with no rows in the table yet: first run, a new file, or one a crashed run left empty. */
  added: string[];
  /** Documents whose content hash changed since they were ingested - their old chunks were replaced. */
  updated: string[];
  /** Documents skipped entirely: not read past the hash, not chunked, not embedded. */
  unchanged: string[];
  /** Documents in the table that no longer exist on disk - their chunks were deleted. */
  removed: string[];
  chunksWritten: number;
}

export interface CorpusIngestOptions {
  /** Expected embedding width. Injectable so tests can use tiny vectors. */
  dimensions?: number;
}

/**
 * Incremental corpus ingestion: diff by content hash -> chunk -> embed ->
 * write; unchanged documents are never re-embedded. No separate state file -
 * the table itself (`listDocumentHashes()`) is the state, so a run that dies
 * halfway just leaves the next run seeing unfinished documents as new.
 */
export class CorpusIngestService {
  private readonly dimensions: number;

  constructor(
    private readonly chunker: ChunkerPort,
    private readonly embeddingPort: EmbeddingPort,
    private readonly writer: VectorStoreWriterPort,
    options: CorpusIngestOptions = {}
  ) {
    this.dimensions = options.dimensions ?? EMBEDDING_DIMENSIONS;
  }

  async ingest(corpusRoot: string): Promise<IngestReport> {
    const ingested = await this.writer.listDocumentHashes();
    const documents = await readCorpus(corpusRoot);
    const onDisk = new Set(documents.map((document) => document.source));
    const report: IngestReport = { added: [], updated: [], unchanged: [], removed: [], chunksWritten: 0 };

    for (const document of documents) {
      const ingestedHash = ingested.get(document.source);
      if (ingestedHash === document.contentHash) {
        report.unchanged.push(document.source);
        continue;
      }

      const records = await this.buildRecords(document);
      await this.writer.replaceDocumentChunks(document.source, records);

      (ingestedHash === undefined ? report.added : report.updated).push(document.source);
      report.chunksWritten += records.length;
    }

    // In the table but no longer on disk. Its chunks would otherwise stay
    // searchable forever and be cited from a document that does not exist.
    for (const source of ingested.keys()) {
      if (onDisk.has(source)) continue;
      await this.writer.deleteDocumentChunks(source);
      report.removed.push(source);
    }

    return report;
  }

  /** Chunks and embeds one document, in a single embedding round trip. */
  private async buildRecords(document: CorpusDocument): Promise<ChunkRecord[]> {
    const texts = await this.chunker.chunk(document.content);
    if (texts.length === 0) return [];

    const vectors = await this.embeddingPort.embedBatch(texts);

    if (vectors[0].length !== this.dimensions) {
      throw new Error(
        `Embedding dimension mismatch: model returned ${vectors[0].length}, store expects ${this.dimensions}. ` +
          `Update EMBEDDING_DIMENSIONS in config/rag.config.ts and delete the vector DB directory to rebuild it.`
      );
    }

    return texts.map((content, index) => ({
      id: `${document.source}#${index}`,
      content,
      embedding: vectors[index],
      source: document.source,
      chunkIndex: index,
      title: document.title,
      documentType: document.documentType,
      contentHash: document.contentHash
    }));
  }
}
