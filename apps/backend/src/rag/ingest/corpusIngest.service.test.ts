import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CorpusIngestService } from './corpusIngest.service.js';
import { DocumentType } from '../../document/domain/document.model.js';
import type { ChunkerPort, EmbeddingPort, VectorStoreWriterPort } from '../domain/ports.js';
import type { ChunkRecord } from '../domain/types.js';

/** Splits on blank lines. No worker, no model - the diff logic is what's under test. */
const chunker: ChunkerPort = {
  chunk: async (document) => document.split('\n\n').filter((part) => part.trim().length > 0)
};

function makeEmbedding(): EmbeddingPort & { calls: number } {
  const port = {
    calls: 0,
    embed: async (text: string) => [text.length, 0, 0],
    embedBatch: async (texts: string[]) => {
      port.calls += texts.length;
      return texts.map((text) => [text.length, 0, 0]);
    }
  };
  return port;
}

/**
 * In-memory stand-in for the LanceDB table. It is ALSO the ingest state
 * (`listDocumentHashes` reads it back), so a test about "the second run"
 * reuses the same writer - the same way the real table survives on disk
 * between two processes.
 */
function makeWriter(): VectorStoreWriterPort & { rows: Map<string, ChunkRecord[]> } {
  const rows = new Map<string, ChunkRecord[]>();
  return {
    rows,
    replaceDocumentChunks: vi.fn(async (source: string, records: ChunkRecord[]) => {
      if (records.length > 0) rows.set(source, records);
      else rows.delete(source);
    }),
    deleteDocumentChunks: vi.fn(async (source: string) => {
      rows.delete(source);
    }),
    countRows: async () => [...rows.values()].reduce((sum, list) => sum + list.length, 0),
    listDocumentHashes: async () => new Map([...rows].map(([source, records]) => [source, records[0].contentHash]))
  };
}

describe('CorpusIngestService', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'ingest-'));
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.writeFile(path.join(root, 'reports', 'a.md'), 'para uno\n\npara dos');
    await fs.writeFile(path.join(root, 'reports', 'b.md'), 'solo una');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  function service(embedding: EmbeddingPort, writer: VectorStoreWriterPort) {
    return new CorpusIngestService(chunker, embedding, writer, { dimensions: 3 });
  }

  it('embeds everything on the first run', async () => {
    const embedding = makeEmbedding();
    const writer = makeWriter();

    const report = await service(embedding, writer).ingest(root);

    expect(report.added.sort()).toEqual(['reports/a.md', 'reports/b.md']);
    expect(report.unchanged).toEqual([]);
    expect(report.chunksWritten).toBe(3);
    expect(embedding.calls).toBe(3);
  });

  it('re-embeds nothing on a second run with an unchanged corpus', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    vi.clearAllMocks(); // forget the first run's calls, keep its rows

    const embedding = makeEmbedding();
    const report = await service(embedding, writer).ingest(root);

    expect(report.unchanged.sort()).toEqual(['reports/a.md', 'reports/b.md']);
    expect(report.added).toEqual([]);
    expect(report.updated).toEqual([]);
    expect(embedding.calls).toBe(0);
    expect(writer.replaceDocumentChunks).not.toHaveBeenCalled();
  });

  it('re-embeds only the document that changed', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    await fs.writeFile(path.join(root, 'reports', 'a.md'), 'para uno EDITADO\n\npara dos');
    vi.clearAllMocks();

    const report = await service(makeEmbedding(), writer).ingest(root);

    expect(report.updated).toEqual(['reports/a.md']);
    expect(report.unchanged).toEqual(['reports/b.md']);
    expect(writer.replaceDocumentChunks).toHaveBeenCalledTimes(1);
  });

  it('drops the chunks of a document removed from the corpus', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    await fs.rm(path.join(root, 'reports', 'b.md'));

    const report = await service(makeEmbedding(), writer).ingest(root);

    expect(report.removed).toEqual(['reports/b.md']);
    expect(writer.deleteDocumentChunks).toHaveBeenCalledWith('reports/b.md');
    expect([...writer.rows.keys()]).toEqual(['reports/a.md']);
  });

  it('re-ingests a document left without rows by a run that died between delete and add', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);
    // Exactly what that crash leaves behind: the document has no rows at all.
    writer.rows.delete('reports/a.md');

    const embedding = makeEmbedding();
    const report = await service(embedding, writer).ingest(root);

    expect(report.added).toEqual(['reports/a.md']);
    expect(report.unchanged).toEqual(['reports/b.md']);
    expect(embedding.calls).toBe(2);
  });

  it('writes citation-ready records: root-relative source, stable id, document hash', async () => {
    const writer = makeWriter();
    await service(makeEmbedding(), writer).ingest(root);

    const records = writer.rows.get('reports/a.md');
    expect(records?.map((r) => r.id)).toEqual(['reports/a.md#0', 'reports/a.md#1']);
    expect(records?.[0].source).toBe('reports/a.md');
    expect(records?.[0].documentType).toBe(DocumentType.REPORTS);
    expect(records?.[0].title).toBe('a');
    // Every chunk of a document carries the SAME document-level hash.
    expect(records?.[0].contentHash).toBe(records?.[1].contentHash);
  });

  it('fails loudly when the embedding dimension does not match the configured one', async () => {
    const wrongSize: EmbeddingPort = {
      embed: async () => [1, 2],
      embedBatch: async (texts) => texts.map(() => [1, 2])
    };

    await expect(service(wrongSize, makeWriter()).ingest(root)).rejects.toThrow(/dimension/i);
  });
});
