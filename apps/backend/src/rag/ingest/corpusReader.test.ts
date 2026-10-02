import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DocumentType } from '../../document/domain/document.model.js';
import { readCorpus, sha256 } from './corpusReader.js';

describe('readCorpus', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'corpus-'));
    await fs.mkdir(path.join(root, 'reports'), { recursive: true });
    await fs.mkdir(path.join(root, 'pictures'), { recursive: true });
    await fs.writeFile(path.join(root, 'reports', 'q1.md'), '# Q1\n\nRevenue grew.');
    await fs.writeFile(path.join(root, 'reports', 'prices.csv'), 'sku,price\nA,1');
    await fs.writeFile(path.join(root, 'pictures', 'pic.png'), Buffer.from([0x89, 0x50]));
    await fs.writeFile(path.join(root, 'notes.txt'), 'top level note');
    // What unzipping the official corpus.zip leaves behind: macOS metadata with a text extension.
    await fs.mkdir(path.join(root, '__MACOSX', 'reports'), { recursive: true });
    await fs.writeFile(path.join(root, '__MACOSX', 'reports', '._q1.md'), Buffer.from([0x00, 0x05, 0x16, 0x07]));
    await fs.writeFile(path.join(root, 'reports', '._q1.md'), Buffer.from([0x00, 0x05, 0x16, 0x07]));
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('walks subdirectories and skips non-text files, hidden files and __MACOSX/', async () => {
    const documents = await readCorpus(root);

    expect(documents.map((d) => d.source).sort()).toEqual([
      'notes.txt',
      'reports/prices.csv',
      'reports/q1.md'
    ]);
  });

  it('stores paths relative to the corpus root, with forward slashes', async () => {
    const documents = await readCorpus(root);
    const report = documents.find((d) => d.source.endsWith('q1.md'));

    expect(report?.source).toBe('reports/q1.md');
    expect(report?.source.startsWith('/')).toBe(false);
  });

  it('derives title from the filename and documentType from the top-level folder', async () => {
    const documents = await readCorpus(root);

    expect(documents.find((d) => d.source === 'reports/q1.md')).toMatchObject({
      title: 'q1',
      documentType: DocumentType.REPORTS
    });
    // A file sitting at the corpus root has no folder to take a type from.
    expect(documents.find((d) => d.source === 'notes.txt')?.documentType).toBe(DocumentType.DATA);
  });

  it('hashes the content, and the hash changes when the content changes', async () => {
    const before = (await readCorpus(root)).find((d) => d.source === 'notes.txt');
    await fs.writeFile(path.join(root, 'notes.txt'), 'top level note EDITED');
    const after = (await readCorpus(root)).find((d) => d.source === 'notes.txt');

    expect(before?.contentHash).toHaveLength(64);
    expect(after?.contentHash).not.toBe(before?.contentHash);
  });
});

describe('sha256', () => {
  it('is deterministic and sensitive to a single character', () => {
    expect(sha256('hola')).toBe(sha256('hola'));
    expect(sha256('hola')).not.toBe(sha256('holA'));
  });
});
