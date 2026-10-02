import { Router, type Request, type Response } from "express";
import type { DocumentRepository } from "../domain/document-repository.port.js";
import { toSummary } from "../domain/document-summary.js";
import {
  DOCUMENT_CONTENT_ERROR,
  DOCUMENT_NOT_FOUND_ERROR,
  INVALID_FILE_ERROR,
  LIST_DOCUMENTS_ERROR,
} from "./documents.router.const.js";

/**
 * Mounted at `/api/documents` in server.ts.
 *
 * `GET /`: the corpus inventory for the UI. Same repository and same
 * `toSummary` as the `list_documents` tool (req. [3.1.1]), so the modal and
 * the model always see the same list.
 *
 * `GET /content?file=<corpus-relative path>`: one whole document, for the
 * source dialog's "Full document" view. `file` is only ever compared with
 * the corpus listing as an opaque id (`findById`), never turned into a
 * filesystem path, so it can't reach outside `corpus/`.
 *
 * Narrowed to the two reads used, so a test can pass a two-function fake.
 */
export function createDocumentsRouter(repository: Pick<DocumentRepository, "findAll" | "findById">): Router {
  const router = Router();

  router.get("/", async (_req: Request, res: Response) => {
    try {
      const summaries = (await repository.findAll()).map(toSummary);
      res.json({ documents: summaries, count: summaries.length });
    } catch (err) {
      console.error("[documents:list]", err);
      res.status(500).json({ error: LIST_DOCUMENTS_ERROR });
    }
  });

  router.get("/content", async (req: Request, res: Response) => {
    const { file } = req.query;
    if (typeof file !== "string" || file === "") {
      res.status(400).json({ error: INVALID_FILE_ERROR });
      return;
    }

    try {
      const document = await repository.findById(file);
      if (!document) {
        res.status(404).json({ error: DOCUMENT_NOT_FOUND_ERROR });
        return;
      }
      res.json({ id: document.id, format: document.format, content: document.content });
    } catch (err) {
      console.error("[documents:content]", err);
      res.status(500).json({ error: DOCUMENT_CONTENT_ERROR });
    }
  });

  return router;
}
