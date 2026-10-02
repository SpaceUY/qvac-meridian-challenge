import { createHash } from 'node:crypto';
import path from 'node:path';
import { DocumentType } from '../../document/domain/document.model.js';
import { CorpusDocumentRepository } from '../../document/infra/corpusDocumentRepository.js';

/** One corpus file, with everything the ingest needs to decide what to do with it. */
export interface CorpusDocument {
  /**
   * Path relative to the corpus root, forward-slashed - e.g.
   * "reports/q1-2026-sales-summary.md". This exact string is what ends up
   * in a citation and what the vector store deletes by, so it is derived
   * once (by the document module, as the document id) and never re-derived
   * downstream.
   */
  source: string;
  content: string;
  /** SHA-256 hex of `content`. The only signal the ingest uses to decide whether a document changed. */
  contentHash: string;
  /** Filename without its extension. */
  title: string;
  /** Derived by the document module from the top-level corpus folder; a file at the root or in an unknown folder is `DATA`. */
  documentType: DocumentType;
}

/**
 * SHA-256 of a string, hex-encoded. Content-based rather than filesystem-
 * based on purpose: `mtime` is rewritten by `unzip`, `git clone` and plain
 * copying, so a corpus that is byte-identical on the evaluator's machine
 * would look entirely new and be re-embedded from scratch - exactly what
 * the acceptance criteria forbid.
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Reads and hashes every text document under `corpusRoot`. Walking, filtering
 * and reading are the document module's job; this only adds the ingest's own
 * metadata. `title` stays the raw filename (not the repository's humanised one).
 */
export async function readCorpus(corpusRoot: string): Promise<CorpusDocument[]> {
  const documents = await new CorpusDocumentRepository(corpusRoot).findAll();

  return documents.map(({ id, content, type }) => ({
    source: id,
    content,
    contentHash: sha256(content),
    title: path.basename(id, path.extname(id)),
    documentType: type
  }));
}
