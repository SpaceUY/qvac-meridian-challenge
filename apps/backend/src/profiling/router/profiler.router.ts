import { Router, type Request, type Response } from "express";
import type { ProfilerPort } from "../domain/ports.js";

/**
 * Mounted at `/api/debug/profiler` by mountProfiler.ts - only when the
 * process was started with QVAC_PROFILER set, so a default `npm run serve`
 * exposes no debug surface (req. [I.6]):
 * - `GET /` - the profiler.exportJSON() snapshot; `?events=true` adds the
 *   raw per-request events (only recorded in `verbose` mode).
 * - `POST /reset` - clears the aggregates, so a benchmark can measure one
 *   phase (e.g. steady-state chat) without the startup model loads mixed in.
 */
export function createProfilerRouter(profiler: Pick<ProfilerPort, "getSnapshot" | "reset">): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response) => {
    res.json(profiler.getSnapshot({ includeRecentEvents: req.query.events === "true" }));
  });

  router.post("/reset", (_req: Request, res: Response) => {
    profiler.reset();
    res.status(204).end();
  });

  return router;
}
