import { describe, expect, it } from "vitest";
import {
  createListDocumentsTool,
  listDocumentsInputSchema,
  listDocumentsOutputSchema,
} from "./listDocumentsTool.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";
import {
  DocumentFormat,
  DocumentStatus,
  DocumentType,
  type ArchitectureDocument,
} from "../../document/domain/document.model.js";

/** In-memory `DocumentRepository` whose `findAll()` result can be swapped between calls, to prove the tool reads live state rather than a value captured at construction time. */
class MutableDocumentRepository implements DocumentRepository {
  documents: ArchitectureDocument[] = [];

  async findAll(): Promise<ArchitectureDocument[]> {
    return this.documents;
  }

  async findById(id: string): Promise<ArchitectureDocument | null> {
    return this.documents.find((document) => document.id === id) ?? null;
  }

  async findByStatus(status: DocumentStatus): Promise<ArchitectureDocument[]> {
    return this.documents.filter((document) => document.status === status);
  }

  async findByType(type: DocumentType): Promise<ArchitectureDocument[]> {
    return this.documents.filter((document) => document.type === type);
  }

  async create(): Promise<ArchitectureDocument> {
    throw new Error("not supported");
  }
}

function makeDocument(
  overrides: Partial<ArchitectureDocument>,
): ArchitectureDocument {
  return {
    id: "policies/escalation-matrix.txt",
    title: "Escalation Matrix",
    type: DocumentType.POLICIES,
    format: DocumentFormat.TEXT,
    status: DocumentStatus.ACTIVE,
    tags: [],
    content: "P1 escalation path...",
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-02"),
    ...overrides,
  };
}

describe("list_documents tool", () => {
  it("is named list_documents and exposes a primitive-only input schema (agent tool loop compatibility)", () => {
    const repository = new MutableDocumentRepository();
    const listDocumentsTool = createListDocumentsTool(repository);

    expect(listDocumentsTool.name).toBe("list_documents");
    expect(listDocumentsTool.description.length).toBeGreaterThan(0);

    const shape = listDocumentsInputSchema.shape;
    expect(Object.keys(shape).sort()).toEqual(["status", "type"]);
  });

  it("returns the current inventory from the repository, not a fixed list", async () => {
    const repository = new MutableDocumentRepository();
    const listDocumentsTool = createListDocumentsTool(repository);

    repository.documents = [makeDocument({})];
    const firstResult = await listDocumentsTool.invoke({});
    const firstParsed = listDocumentsOutputSchema.parse(firstResult);
    expect(firstParsed.count).toBe(1);

    // Simulates new ingestion happening between two tool calls in the same conversation.
    repository.documents = [
      makeDocument({ id: "policies/escalation-matrix.txt" }),
      makeDocument({
        id: "emails/004-hiring-plan.md",
        title: "Hiring Plan",
        type: DocumentType.EMAIL,
        format: DocumentFormat.MARKDOWN,
      }),
    ];
    const secondResult = await listDocumentsTool.invoke({});
    const secondParsed = listDocumentsOutputSchema.parse(secondResult);
    expect(secondParsed.count).toBe(2);
    expect(secondParsed.documents.map((d) => d.id).sort()).toEqual([
      "emails/004-hiring-plan.md",
      "policies/escalation-matrix.txt",
    ]);
  });

  it("filters by type when provided", async () => {
    const repository = new MutableDocumentRepository();
    repository.documents = [
      makeDocument({ id: "a", type: DocumentType.POLICIES }),
      makeDocument({ id: "b", type: DocumentType.EMAIL }),
    ];
    const listDocumentsTool = createListDocumentsTool(repository);

    const result = await listDocumentsTool.invoke({ type: DocumentType.EMAIL });
    const parsed = listDocumentsOutputSchema.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.documents[0].id).toBe("b");
  });

  it("filters by status when provided", async () => {
    const repository = new MutableDocumentRepository();
    repository.documents = [
      makeDocument({ id: "a", status: DocumentStatus.ACTIVE }),
      makeDocument({ id: "b", status: DocumentStatus.ARCHIVED }),
    ];
    const listDocumentsTool = createListDocumentsTool(repository);

    const result = await listDocumentsTool.invoke({
      status: DocumentStatus.ARCHIVED,
    });
    const parsed = listDocumentsOutputSchema.parse(result);

    expect(parsed.count).toBe(1);
    expect(parsed.documents[0].id).toBe("b");
  });

  it("rejects an invalid type argument via the input schema", () => {
    expect(() => listDocumentsInputSchema.parse({ type: "NOT_A_TYPE" })).toThrow();
  });
});
