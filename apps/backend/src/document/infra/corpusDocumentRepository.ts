import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DocumentFormat,
  DocumentStatus,
  DocumentType,
  type ArchitectureDocument,
} from "../domain/document.model.js";
import type { DocumentRepository } from "../domain/document-repository.port.js";
import { CORPUS_ROOT } from "../../config/rag.config.js";
const FORMAT_BY_EXTENSION: Record<string, DocumentFormat> = {
  ".md": DocumentFormat.MARKDOWN,
  ".json": DocumentFormat.JSON,
  ".csv": DocumentFormat.CSV,
  ".html": DocumentFormat.HTML,
  ".txt": DocumentFormat.TEXT,
};

const TYPE_BY_TOP_LEVEL_FOLDER: Record<string, DocumentType> = {
  data: DocumentType.DATA,
  reports: DocumentType.REPORTS,
  transcripts: DocumentType.TRANSCRIPT,
  faqs: DocumentType.FAQ,
  emails: DocumentType.EMAIL,
  policies: DocumentType.POLICIES,
};

export const TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".csv",
  ".json",
  ".html",
]);

export async function listFilesRecursively(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else if (TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function toDocumentId(corpusDir: string, filePath: string): string {
  return path.relative(corpusDir, filePath).split(path.sep).join("/");
}

function toTitle(filePath: string): string {
  return path
    .basename(filePath, path.extname(filePath))
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function toDocumentType(id: string): DocumentType {
  const topLevelFolder = id.split("/")[0];
  return TYPE_BY_TOP_LEVEL_FOLDER[topLevelFolder] ?? DocumentType.DATA;
}

/**
 * Reads a document's current state straight from `corpus/` on disk - the
 * same directory `loadCorpusContext` reads for full-context injection - so
 * the inventory always reflects whatever is actually ingested, not a
 * separately maintained list.
 */
export class CorpusDocumentRepository implements DocumentRepository {
  constructor(private readonly corpusDir: string = CORPUS_ROOT) {}

  async findAll(): Promise<ArchitectureDocument[]> {
    const filePaths = await listFilesRecursively(this.corpusDir);
    const textFilePaths = filePaths.filter((filePath) =>
      TEXT_EXTENSIONS.has(path.extname(filePath)),
    );

    return Promise.all(
      textFilePaths.map((filePath) => this.toDocument(filePath)),
    );
  }

  async findById(id: string): Promise<ArchitectureDocument | null> {
    const documents = await this.findAll();
    return documents.find((document) => document.id === id) ?? null;
  }

  async findByStatus(status: DocumentStatus): Promise<ArchitectureDocument[]> {
    const documents = await this.findAll();
    return documents.filter((document) => document.status === status);
  }

  async findByType(type: DocumentType): Promise<ArchitectureDocument[]> {
    const documents = await this.findAll();
    return documents.filter((document) => document.type === type);
  }

  async create(
    _data: Omit<ArchitectureDocument, "id" | "createdAt" | "updatedAt">,
  ): Promise<ArchitectureDocument> {
    throw new Error(
      "CorpusDocumentRepository is read-only: it reflects corpus/ as ingested on disk and does not support creating documents.",
    );
  }

  private async toDocument(filePath: string): Promise<ArchitectureDocument> {
    const id = toDocumentId(this.corpusDir, filePath);
    const [content, stats] = await Promise.all([
      fs.readFile(filePath, "utf-8"),
      fs.stat(filePath),
    ]);

    return {
      id,
      title: toTitle(filePath),
      type: toDocumentType(id),
      format:
        FORMAT_BY_EXTENSION[path.extname(filePath)] ?? DocumentFormat.TEXT,
      status: DocumentStatus.ACTIVE,
      tags: [],
      content,
      createdAt: stats.birthtime,
      updatedAt: stats.mtime,
    };
  }
}
