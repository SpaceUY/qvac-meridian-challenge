import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as lancedb from '@lancedb/lancedb';
import { LanceDbVectorStore, LanceDbVectorStoreWriter } from './lanceDbVectorStore.js';
import type { ChunkRecord } from '../domain/types.js';

/** Real LanceDB directory in a temp folder, not a mock - the point is the on-disk behavior itself. */
describe('LanceDbVectorStore', () => {
  let dbDir: string;

  // Query [1, 0]: cosine similarity is 1.0 for [2,0], 0.8 for [4,3], 0 for [0,5].
  const ROWS = [
    { id: 'reports/a.md#0', vector: [2, 0], content: 'A', source: 'reports/a.md', chunkIndex: 0, title: 'A', documentType: 'reports', contentHash: 'h1' },
    { id: 'emails/b.md#0', vector: [4, 3], content: 'B', source: 'emails/b.md', chunkIndex: 0, title: 'B', documentType: 'emails', contentHash: 'h2' },
    { id: 'emails/b.md#1', vector: [0, 5], content: 'C', source: 'emails/b.md', chunkIndex: 1, title: 'B', documentType: 'emails', contentHash: 'h2' }
  ];

  beforeAll(async () => {
    dbDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lancedb-test-'));
    const db = await lancedb.connect(dbDir);
    await db.createTable('chunks', ROWS);
  });

  afterAll(async () => {
    await fs.rm(dbDir, { recursive: true, force: true });
  });

  it('reports whether the table exists', async () => {
    expect(await LanceDbVectorStore.exists(dbDir)).toBe(true);
    expect(await LanceDbVectorStore.exists(path.join(dbDir, 'nope'))).toBe(false);
  });

  it('ranks by cosine similarity, best first', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    const results = await store.search([1, 0], { topK: 10, minScore: -1 });

    expect(results.map((r) => r.id)).toEqual(['reports/a.md#0', 'emails/b.md#0', 'emails/b.md#1']);
    expect(results[0].score).toBeCloseTo(1, 5);
    expect(results[1].score).toBeCloseTo(0.8, 5);
  });

  it('drops results below minScore', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    const results = await store.search([1, 0], { topK: 10, minScore: 0.9 });

    expect(results.map((r) => r.id)).toEqual(['reports/a.md#0']);
  });

  it('caps results at topK', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    expect(await store.search([1, 0], { topK: 1, minScore: -1 })).toHaveLength(1);
  });

  it('carries the citation fields through to RetrievedChunk', async () => {
    const store = await LanceDbVectorStore.open(dbDir);

    const [top] = await store.search([1, 0], { topK: 1, minScore: -1 });

    expect(top.source).toBe('reports/a.md');
    expect(top.content).toBe('A');
    expect(top.metadata).toEqual({ title: 'A', documentType: 'reports', chunkIndex: 0 });
  });
});

describe('LanceDbVectorStoreWriter', () => {
  function record(source: string, index: number, hash: string): ChunkRecord {
    return {
      id: `${source}#${index}`,
      content: `content ${index}`,
      embedding: [index, 1],
      source,
      chunkIndex: index,
      title: source,
      documentType: 'reports',
      contentHash: hash
    };
  }

  async function freshWriter() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lancedb-writer-'));
    return { dir, writer: await LanceDbVectorStoreWriter.open(dir) };
  }

  it('reports no documents before anything was written', async () => {
    const { writer } = await freshWriter();

    expect((await writer.listDocumentHashes()).size).toBe(0);
  });

  it('creates the table on the first write', async () => {
    const { writer } = await freshWriter();

    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1')]);

    expect(await writer.countRows()).toBe(1);
  });

  it('replaces only the given document, leaving the others untouched', async () => {
    const { writer } = await freshWriter();
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1'), record('reports/a.md', 1, 'h1')]);
    await writer.replaceDocumentChunks('emails/b.md', [record('emails/b.md', 0, 'h2')]);

    // a.md changed and now produces a single chunk instead of two.
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1-v2')]);

    expect(await writer.countRows()).toBe(2);
    // One entry per document, and a.md now carries its NEW hash.
    expect(await writer.listDocumentHashes()).toEqual(new Map([['reports/a.md', 'h1-v2'], ['emails/b.md', 'h2']]));
  });

  it('deletes every chunk of a document', async () => {
    const { writer } = await freshWriter();
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1')]);
    await writer.replaceDocumentChunks('emails/b.md', [record('emails/b.md', 0, 'h2')]);

    await writer.deleteDocumentChunks('reports/a.md');

    expect([...(await writer.listDocumentHashes()).keys()]).toEqual(['emails/b.md']);
  });

  it('survives reopening the same directory', async () => {
    const { dir, writer } = await freshWriter();
    await writer.replaceDocumentChunks('reports/a.md', [record('reports/a.md', 0, 'h1')]);

    const reopened = await LanceDbVectorStoreWriter.open(dir);

    expect(await reopened.countRows()).toBe(1);
  });
});
