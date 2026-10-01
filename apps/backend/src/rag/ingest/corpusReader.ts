import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TEXT_EXTENSIONS } from '../../config/rag.config.js';

/** One corpus file, with everything the ingest needs to decide what to do with it. */
export interface CorpusDocument {
  /**
   * Path relative to the corpus root, forward-slashed - e.g.
   * "reports/q1-2026-sales-summary.md". This exact string is what ends up
   * in a citation and what the vector store deletes by, so it is derived
   * here, once, and never re-derived downstream.
   */
  source: string;
  content: string;
  /** SHA-256 hex of `content`. The only signal the ingest uses to decide whether a document changed. */
  contentHash: string;
  /** Filename without its extension. */
  title: string;
  /** Top-level corpus folder ('reports', 'emails', ...), or '' for a file sitting at the root. */
  documentType: string;
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
 * Recursively lists every text file under `dir`, skipping binaries (`ragChunk()` does not process them).
 * Also skips hidden entries and `__MACOSX/`: the official `corpus.zip` ships 39 macOS
 * metadata files like `__MACOSX/emails/._007-sla-reminder.md` - binary, but with a
 * `.md` extension, so an extension check alone would ingest (and later cite) them.
 */
async function listTextFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTextFiles(entryPath)));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
}

/** Reads and hashes every text document under `corpusRoot`. */
export async function readCorpus(corpusRoot: string): Promise<CorpusDocument[]> {
  const absolutePaths = await listTextFiles(corpusRoot);

  return Promise.all(
    absolutePaths.map(async (absolutePath) => {
      const content = await fs.readFile(absolutePath, 'utf8');
      // `path.relative` yields backslashes on Windows; citations must be
      // stable across platforms, so they are normalised to forward slashes.
      const source = path.relative(corpusRoot, absolutePath).split(path.sep).join('/');
      const [head, ...rest] = source.split('/');

      return {
        source,
        content,
        contentHash: sha256(content),
        title: path.basename(source, path.extname(source)),
        documentType: rest.length > 0 ? head : ''
      };
    })
  );
}
