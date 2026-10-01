import { Router, type Request, type Response } from 'express';
import { handleError } from '../../models/router/models.router.helpers.js';
import { SynthesisInProgressError } from '../domain/errors.js';
import type { TtsService } from '../service/tts.service.js';
import { EMPTY_TEXT_ERROR, NO_AUDIO_ERROR, SYNTHESIS_IN_PROGRESS_ERROR } from './tts.router.const.js';
import { parseText } from './tts.router.helpers.js';

/**
 * Thin HTTP layer - parse, delegate to TtsService, respond. Test/dev
 * surface like models.router.ts, not the UI's final contract: a future
 * voice orchestrator should call TtsService directly instead.
 */
export function createTtsRouter(service: TtsService): Router {
  const router = Router();

  // 202 without waiting for synthesis to finish - that's what makes it cancellable.
  router.post('/', async (req: Request, res: Response) => {
    const text = parseText(req.body);
    if (!text) {
      res.status(400).json({ error: EMPTY_TEXT_ERROR });
      return;
    }
    try {
      await service.synthesize(text);
      res.status(202).json({ ok: true });
    } catch (err) {
      if (err instanceof SynthesisInProgressError) {
        res.status(409).json({ error: SYNTHESIS_IN_PROGRESS_ERROR });
        return;
      }
      handleError(res, err);
    }
  });

  router.post('/cancel', async (_req: Request, res: Response) => {
    try {
      await service.cancel();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, err);
    }
  });

  router.get('/status', (_req: Request, res: Response) => {
    res.json({ state: service.getStatus() });
  });

  router.get('/audio', (_req: Request, res: Response) => {
    const audio = service.getAudio();
    if (!audio) {
      res.status(404).json({ error: NO_AUDIO_ERROR });
      return;
    }
    res.setHeader('Content-Type', 'audio/wav');
    res.send(audio);
  });

  return router;
}
