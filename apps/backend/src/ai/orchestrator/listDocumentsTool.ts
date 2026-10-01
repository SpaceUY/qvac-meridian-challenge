import * as z from "zod";
import { tool } from "@langchain/core/tools";
import {
  DocumentFormat,
  DocumentStatus,
  DocumentType,
} from "../../document/domain/document.model.js";
import type { DocumentRepository } from "../../document/domain/document-repository.port.js";
import { toSummary } from "../../document/domain/document-summary.js";

const documentTypeValues = Object.values(DocumentType) as [string, ...string[]];
const documentStatusValues = Object.values(DocumentStatus) as [
  string,
  ...string[],
];
const documentFormatValues = Object.values(DocumentFormat) as [
  string,
  ...string[],
];

export const listDocumentsInputSchema = z.object({
  type: z
    .enum(documentTypeValues)
    .optional()
    .describe("Only return documents of this type."),
  status: z
    .enum(documentStatusValues)
    .optional()
    .describe("Only return documents with this status."),
});

export const documentSummarySchema = z.object({
  id: z.string().describe("Stable identifier - the document's corpus path."),
  title: z.string(),
  type: z.enum(documentTypeValues),
  format: z.enum(documentFormatValues),
  status: z.enum(documentStatusValues),
  tags: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});

export const listDocumentsOutputSchema = z.object({
  documents: z.array(documentSummarySchema),
  count: z.number(),
});

export type ListDocumentsInput = z.infer<typeof listDocumentsInputSchema>;
export type ListDocumentsOutput = z.infer<typeof listDocumentsOutputSchema>;

/**
 * Builds the `list_documents` tool around a `DocumentRepository`, so the
 * inventory it reports always reflects that repository's current state
 * instead of a value baked in at tool-construction time.
 */
export function createListDocumentsTool(repository: DocumentRepository) {
  return tool(
    async (args: ListDocumentsInput): Promise<ListDocumentsOutput> => {
      const documents = await repository.findAll();

      const filtered = documents.filter(
        (document) =>
          (!args.type || document.type === args.type) &&
          (!args.status || document.status === args.status),
      );

      const summaries = filtered.map(toSummary);
      return listDocumentsOutputSchema.parse({
        documents: summaries,
        count: summaries.length,
      });
    },
    {
      name: "list_documents",
      description:
        "Lists the documents currently ingested into the corpus, with their id, title, type, format, status and tags. " +
        "Use this to discover what documents are available before answering questions about what has or hasn't been ingested. " +
        "Optionally filter by document type or status.",
      schema: listDocumentsInputSchema,
    },
  );
}
