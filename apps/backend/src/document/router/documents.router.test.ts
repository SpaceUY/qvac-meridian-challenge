import * as http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createDocumentsRouter } from "./documents.router.js";
import {
  DOCUMENT_CONTENT_ERROR,
  DOCUMENT_NOT_FOUND_ERROR,
  INVALID_FILE_ERROR,
  LIST_DOCUMENTS_ERROR,
} from "./documents.router.const.js";
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
    app.use("/api/documents", createDocumentsRouter({ findAll, findById: async () => null }));
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

describe("GET /api/documents/content", () => {
  let server: http.Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function listen(findById: (id: string) => Promise<ArchitectureDocument | null>): Promise<string> {
    const app = express();
    app.use("/api/documents", createDocumentsRouter({ findAll: async () => [], findById }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}/api/documents/content`;
  }

  const knowsWarranty = async (id: string) => (id === WARRANTY.id ? WARRANTY : null);

  it("returns the whole document for a corpus path: id, format and content, nothing else", async () => {
    const url = await listen(knowsWarranty);

    const response = await fetch(`${url}?file=${encodeURIComponent("policies/warranty-terms.md")}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: "policies/warranty-terms.md",
      format: "MARKDOWN",
      content: "# Warranty\n\nThe X4 carries a 24-month warranty.",
    });
  });

  it("responds 404 for a file that is not in the corpus, a path-traversal attempt included", async () => {
    const asked: string[] = [];
    const url = await listen(async (id) => {
      asked.push(id);
      return knowsWarranty(id);
    });

    const response = await fetch(`${url}?file=${encodeURIComponent("../../etc/passwd")}`);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: DOCUMENT_NOT_FOUND_ERROR });
    // The path is only ever compared with the corpus listing, as an opaque id.
    expect(asked).toEqual(["../../etc/passwd"]);
  });

  it("responds 400 when file is missing, empty or repeated", async () => {
    const url = await listen(knowsWarranty);

    for (const query of ["", "?file=", "?file=a.md&file=b.md"]) {
      const response = await fetch(`${url}${query}`);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: INVALID_FILE_ERROR });
    }
  });

  it("responds 500 with a generic error, without the internal reason, when the corpus can't be read", async () => {
    const url = await listen(async () => { throw new Error("EACCES: /secret/path"); });

    const response = await fetch(`${url}?file=policies/warranty-terms.md`);

    expect(response.status).toBe(500);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ error: DOCUMENT_CONTENT_ERROR });
    expect(text).not.toContain("EACCES");
  });
});
