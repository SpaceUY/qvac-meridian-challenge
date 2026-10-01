import { Router, type Request, type Response } from "express";
import type { DocumentRepository } from "../domain/document-repository.port.js";
import { toSummary } from "../domain/document-summary.js";
import { LIST_DOCUMENTS_ERROR } from "./documents.router.const.js";

/**
 * `GET /`, mounted at `/api/documents` in server.ts: the corpus inventory
 * for the UI. Same repository and same `toSummary` as the `list_documents`
 * tool (req. [3.1.1]), so the modal and the model always see the same list.
 * Narrowed to `findAll` so a test can pass a one-function fake.
 */
export function createDocumentsRouter(repository: Pick<DocumentRepository, "findAll">): Router {
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

  return router;
}
