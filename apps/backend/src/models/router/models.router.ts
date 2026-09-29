import { Router, type Request, type Response } from 'express';
import type { ModelManagementService } from '../service/models.service.js';
import { EMPTY_PROMPT_ERROR, INVALID_SOURCE_ERROR } from './models.router.const.js';
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

  router.post('/load', async (req: Request, res: Response) => {
    const source = parseModelSource(req.body);
    if (!source) {
      res.status(400).json({ error: INVALID_SOURCE_ERROR });
      return;
    }
    try {
      const loaded = await service.loadModel(source);
      res.json({ modelId: loaded.modelId });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.post('/:modelId/infer', async (req: Request<{ modelId: string }>, res: Response) => {
    const prompt = parsePrompt(req.body);
    if (!prompt) {
      res.status(400).json({ error: EMPTY_PROMPT_ERROR });
      return;
    }
    try {
      const result = await service.infer(req.params.modelId, prompt);
      res.json(result);
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
