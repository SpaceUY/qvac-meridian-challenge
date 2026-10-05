import { createHash } from 'node:crypto';
import path from 'node:path';
import { DocumentType } from '../../document/domain/document.model.js';
import { CorpusDocumentRepository } from '../../document/infra/corpusDocumentRepository.js';

/** One corpus file, with everything the ingest needs to decide what to do with it. */
export interface CorpusDocument {
  /** Path relative to the corpus root, forward-slashed (e.g. "reports/q1-2026-sales-summary.md") - this exact string is the citation path and the vector store's delete key. */
  source: string;
  content: string;
  /** SHA-256 hex of `content`. The only signal the ingest uses to decide whether a document changed. */
  contentHash: string;
  title: string;
  /** Derived by the document module from the top-level corpus folder; a file at the root or in an unknown folder is `DATA`. */
  documentType: DocumentType;
}

/** SHA-256 hex digest. Content-based, not `mtime`-based: `mtime` gets rewritten by unzip/git clone, which would make an identical corpus look entirely new and force a full re-embed. */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** Reads and hashes every text document under `corpusRoot`; `title` stays the raw filename, not the document module's humanised one. */
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
