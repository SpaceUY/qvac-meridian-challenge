import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CorpusDocumentRepository } from "./corpusDocumentRepository.js";
import { DocumentFormat, DocumentStatus, DocumentType } from "../domain/document.model.js";

describe("CorpusDocumentRepository", () => {
  let corpusDir: string;

  beforeEach(async () => {
    corpusDir = await fs.mkdtemp(path.join(os.tmpdir(), "corpus-repo-test-"));
    await fs.mkdir(path.join(corpusDir, "policies"));
    await fs.writeFile(
      path.join(corpusDir, "policies", "escalation-matrix.txt"),
      "P1 escalation path: L1 to L2 within 30 minutes.",
    );
    await fs.mkdir(path.join(corpusDir, "emails"));
    await fs.writeFile(
      path.join(corpusDir, "emails", "004-hiring-plan.md"),
      "# Hiring plan\n\nApproved to hire two technicians.",
    );
    // Binary file: on disk but not part of the ingested inventory.
    await fs.writeFile(path.join(corpusDir, "logo.png"), Buffer.from([0, 1, 2]));
  });

  afterEach(async () => {
    await fs.rm(corpusDir, { recursive: true, force: true });
  });

  it("derives the inventory from whatever text files are currently on disk under corpus/, skipping binaries", async () => {
    const repository = new CorpusDocumentRepository(corpusDir);

    const documents = await repository.findAll();

    expect(documents).toHaveLength(2);
    const ids = documents.map((document) => document.id).sort();
    expect(ids).toEqual([
      "emails/004-hiring-plan.md",
      "policies/escalation-matrix.txt",
    ]);
  });

  it("skips hidden files and __MACOSX/ metadata even though they carry a text extension", async () => {
    await fs.mkdir(path.join(corpusDir, "__MACOSX", "emails"), { recursive: true });
    await fs.writeFile(path.join(corpusDir, "__MACOSX", "emails", "._004-hiring-plan.md"), Buffer.from([0, 5, 22, 7]));
    await fs.writeFile(path.join(corpusDir, "emails", "._004-hiring-plan.md"), Buffer.from([0, 5, 22, 7]));
    const repository = new CorpusDocumentRepository(corpusDir);

    const ids = (await repository.findAll()).map((document) => document.id).sort();

    expect(ids).toEqual(["emails/004-hiring-plan.md", "policies/escalation-matrix.txt"]);
  });

  it("derives type from the top-level folder and format from the file extension", async () => {
    const repository = new CorpusDocumentRepository(corpusDir);

    const documents = await repository.findAll();
    const escalation = documents.find((d) => d.id === "policies/escalation-matrix.txt");
    const hiringPlan = documents.find((d) => d.id === "emails/004-hiring-plan.md");

    expect(escalation?.type).toBe(DocumentType.POLICIES);
    expect(escalation?.format).toBe(DocumentFormat.TEXT);
    expect(escalation?.status).toBe(DocumentStatus.ACTIVE);
    expect(escalation?.content).toContain("P1 escalation path");

    expect(hiringPlan?.type).toBe(DocumentType.EMAIL);
    expect(hiringPlan?.format).toBe(DocumentFormat.MARKDOWN);
  });

  it("reflects newly ingested files without any code change - the inventory is not a hardcoded list", async () => {
    const repository = new CorpusDocumentRepository(corpusDir);
    expect(await repository.findAll()).toHaveLength(2);

    await fs.mkdir(path.join(corpusDir, "faqs"));
    await fs.writeFile(
      path.join(corpusDir, "faqs", "new-faq.md"),
      "Newly ingested FAQ content.",
    );

    const documents = await repository.findAll();
    expect(documents).toHaveLength(3);
    expect(documents.some((d) => d.id === "faqs/new-faq.md")).toBe(true);
  });

  it("findById returns the matching document or null", async () => {
    const repository = new CorpusDocumentRepository(corpusDir);

    const found = await repository.findById("policies/escalation-matrix.txt");
    expect(found?.title).toBe("Escalation Matrix");

    expect(await repository.findById("does/not-exist.md")).toBeNull();
  });

  it("findByType and findByStatus filter the inventory", async () => {
    const repository = new CorpusDocumentRepository(corpusDir);

    const emails = await repository.findByType(DocumentType.EMAIL);
    expect(emails).toHaveLength(1);
    expect(emails[0].id).toBe("emails/004-hiring-plan.md");

    const active = await repository.findByStatus(DocumentStatus.ACTIVE);
    expect(active).toHaveLength(2);

    const archived = await repository.findByStatus(DocumentStatus.ARCHIVED);
    expect(archived).toHaveLength(0);
  });

  it("create() is not supported - the corpus is a read-only ingestion source", async () => {
    const repository = new CorpusDocumentRepository(corpusDir);

    await expect(
      repository.create({
        title: "New",
        type: DocumentType.DATA,
        format: DocumentFormat.MARKDOWN,
        status: DocumentStatus.ACTIVE,
        tags: [],
        content: "content",
      }),
    ).rejects.toThrow();
  });
});
