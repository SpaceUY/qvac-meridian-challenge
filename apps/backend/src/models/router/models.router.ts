import { Router, type Request, type Response } from 'express';
import type { ModelManagementService } from '../service/models.service.js';
import { EMPTY_PROMPT_ERROR, INVALID_SOURCE_ERROR, REQUEST_NOT_FOUND_ERROR } from './models.router.const.js';
import { handleError, parseModelSource, parsePrompt, parseRegistryQuery } from './models.router.helpers.js';

/**
 * Thin HTTP layer for Local Model Management: every handler is
 * parse -> delegate -> respond. Input parsing/validation lives in
 * `models.router.helpers.ts`; business logic and model-state decisions
 * (including "is this model loaded?") live in `ModelManagementService` -
 * this file never checks or guesses at service state itself.
 */
export function createModelsRouter(service: ModelManagementService): Router {
  const router = Router();

  router.get('/registry', async (req: Request, res: Response) => {
    try {
      const query = parseRegistryQuery(req.query);
      const models = query ? await service.searchRegistry(query) : await service.listRegistry();
      res.json({ models });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/provision', async (req: Request, res: Response) => {
    const source = parseModelSource(req.body);
    if (!source) {
      res.status(400).json({ error: INVALID_SOURCE_ERROR });
      return;
    }
    try {
      await service.provisionModel(source);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Responds as soon as requestId exists (202), without waiting for the
  // load to settle - that's what makes it cancellable: a client can send
  // POST /cancel/:requestId using this response's requestId while the load
  // is still running. GET /requests/:requestId reports the eventual
  // outcome (a blocking "wait for the full result" response can't be
  // raced by a cancel that arrives after the response already went out).
  router.post('/load', (req: Request, res: Response) => {
    const source = parseModelSource(req.body);
    if (!source) {
      res.status(400).json({ error: INVALID_SOURCE_ERROR });
      return;
    }
    try {
      const pending = service.loadModel(source);
      pending.catch(() => {}); // outcome is observed via GET /requests/:requestId; avoid an unhandled rejection here
      res.status(202).json({ requestId: pending.requestId });
    } catch (err) {
      handleError(res, err);
    }
  });

  // Same immediate-response/cancellable convention as /load, above.
  router.post('/:modelId/infer', (req: Request<{ modelId: string }>, res: Response) => {
    const prompt = parsePrompt(req.body);
    if (!prompt) {
      res.status(400).json({ error: EMPTY_PROMPT_ERROR });
      return;
    }
    try {
      const pending = service.infer(req.params.modelId, prompt);
      pending.catch(() => {}); // outcome is observed via GET /requests/:requestId; avoid an unhandled rejection here
      res.status(202).json({ requestId: pending.requestId });
    } catch (err) {
      handleError(res, err);
    }
  });

  // requestId comes from a prior /load or /:modelId/infer response's
  // `requestId` field - reports whether that operation is still pending,
  // succeeded, failed, or was cancelled.
  router.get('/requests/:requestId', (req: Request<{ requestId: string }>, res: Response) => {
    const status = service.getRequestStatus(req.params.requestId);
    if (!status) {
      res.status(404).json({ error: REQUEST_NOT_FOUND_ERROR });
      return;
    }
    res.json(status);
  });

  // requestId comes from the `requestId` field on a prior /load or
  // /:modelId/infer response - cancels that exact operation if it's still
  // in flight. Safe to call for an unknown, already-completed, or
  // already-cancelled requestId (see ModelManagementService.cancel).
  router.post('/cancel/:requestId', async (req: Request<{ requestId: string }>, res: Response) => {
    try {
      await service.cancel(req.params.requestId);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/:modelId/unload', async (req: Request<{ modelId: string }>, res: Response) => {
    try {
      await service.unloadModel(req.params.modelId);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/close', async (_req: Request, res: Response) => {
    try {
      await service.close();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  return router;
}
