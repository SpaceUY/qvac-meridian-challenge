import * as http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createDocumentsRouter } from "./documents.router.js";
import { LIST_DOCUMENTS_ERROR } from "./documents.router.const.js";
import {
  DocumentFormat,
  DocumentStatus,
  DocumentType,
  type ArchitectureDocument,
} from "../domain/document.model.js";

const WARRANTY: ArchitectureDocument = {
  id: "policies/warranty-terms.md",
  title: "Warranty Terms",
  type: DocumentType.POLICIES,
  format: DocumentFormat.MARKDOWN,
  status: DocumentStatus.ACTIVE,
  tags: [],
  content: "# Warranty\n\nThe X4 carries a 24-month warranty.",
  createdAt: new Date("2026-06-01T00:00:00.000Z"),
  updatedAt: new Date("2026-06-02T00:00:00.000Z"),
};

describe("GET /api/documents", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function listen(findAll: () => Promise<ArchitectureDocument[]>): Promise<string> {
    const app = express();
    app.use("/api/documents", createDocumentsRouter({ findAll }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/api/documents`;
  }

  it("returns the same summaries list_documents gives the model, plus the count - never the content", async () => {
    const response = await fetch(await listen(async () => [WARRANTY]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      documents: [
        {
          id: "policies/warranty-terms.md",
          title: "Warranty Terms",
          type: "POLICIES",
          format: "MARKDOWN",
          status: "ACTIVE",
          tags: [],
          updatedAt: "2026-06-02T00:00:00.000Z",
        },
      ],
      count: 1,
    });
  });

  it("responds 500 with a readable error when the corpus can't be read", async () => {
    const response = await fetch(await listen(async () => { throw new Error("EACCES"); }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: LIST_DOCUMENTS_ERROR });
  });
});
