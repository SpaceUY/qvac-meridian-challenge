import type {
  ArchitectureDocument,
  DocumentFormat,
  DocumentStatus,
  DocumentType,
} from "./document.model.js";

/**
 * What the corpus inventory says about one document - everything but its
 * content. Shared by the list_documents tool (for the model) and
 * GET /api/documents (for the UI), so both always report the same
 * inventory (req. [3.1.1]).
 */
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
