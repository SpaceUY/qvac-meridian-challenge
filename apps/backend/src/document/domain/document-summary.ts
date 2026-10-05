import type {
  ArchitectureDocument,
  DocumentFormat,
  DocumentStatus,
  DocumentType,
} from "./document.model.js";

/** Document metadata without content - shared by list_documents and GET /api/documents so both report the same inventory (req [3.1.1]). */
export interface DocumentSummary {
  id: string;
  title: string;
  type: DocumentType;
  format: DocumentFormat;
  status: DocumentStatus;
  tags: string[];
  /** ISO 8601 - a Date doesn't survive JSON. */
  updatedAt: string;
}

export function toSummary(document: ArchitectureDocument): DocumentSummary {
  return {
    id: document.id,
    title: document.title,
    type: document.type,
    format: document.format,
    status: document.status,
    tags: document.tags,
    updatedAt: document.updatedAt.toISOString(),
  };
}
