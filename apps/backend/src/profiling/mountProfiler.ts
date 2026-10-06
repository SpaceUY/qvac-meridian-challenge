import type { Express } from "express";
import type { ProfilerPort } from "./domain/ports.js";
import type { ProfilerOptions } from "./domain/types.js";
import { QvacProfilerAdapter } from "./infra/qvacProfilerAdapter.js";
import { createProfilerRouter } from "./router/profiler.router.js";

export const PROFILER_ROUTE = "/api/debug/profiler";

/**
 * Turns the SDK profiler on and mounts its export route - or does nothing
 * when `options` is undefined (QVAC_PROFILER unset). server.ts calls this
 * BEFORE constructing QvacRuntimeAdapter/ReadinessService, so the snapshot
 * also captures startup model loads, not just steady-state requests.
 * `createProfiler` is a parameter only so a test can pass a fake.
 */
export function mountProfiler(
  app: Express,
  options: ProfilerOptions | undefined,
  createProfiler: () => ProfilerPort = () => new QvacProfilerAdapter(),
): ProfilerPort | undefined {
  if (!options) return undefined;

  const profiler = createProfiler();
  profiler.enable(options);
  app.use(PROFILER_ROUTE, createProfilerRouter(profiler));
  console.log(`[profiling] QVAC profiler on (mode: ${options.mode}) - export at GET ${PROFILER_ROUTE}`);
  return profiler;
}
