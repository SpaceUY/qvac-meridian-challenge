import type {
  ArchitectureDocument,
  DocumentStatus,
  DocumentType,
} from "./document.model.ts";

export const DOCUMENT_REPOSITORY = Symbol("DOCUMENT_REPOSITORY");

export interface DocumentRepository {
  findAll(): Promise<ArchitectureDocument[]>; // TODO: for list_documents tool
  findById(id: string): Promise<ArchitectureDocument | null>;
  findByStatus(status: DocumentStatus): Promise<ArchitectureDocument[]>;
  findByType(type: DocumentType): Promise<ArchitectureDocument[]>;
  create(
    data: Omit<ArchitectureDocument, "id" | "createdAt" | "updatedAt">,
  ): Promise<ArchitectureDocument>;
}
