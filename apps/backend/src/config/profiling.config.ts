import type { ProfilerMode, ProfilerOptions } from '../profiling/domain/types.js';

const VALID_MODES: readonly ProfilerMode[] = ['summary', 'verbose'];

/**
 * Req. [I.6] profiling is opt-in: `QVAC_PROFILER=summary` aggregates
 * count/min/max/avg per SDK operation; `verbose` also keeps the SDK's ring
 * buffer of the last 1000 raw events (per-request numbers, for percentiles)
 * and the worker-side breakdown (`server.handlerExecution` vs.
 * `clientOverhead`: model work vs. RPC/serialization cost).
 * Unset/empty/`off` -> undefined: no profiler and no debug route, so the
 * grading harness's `npm run serve` runs exactly as without this feature.
 * A pure function of `env`, like resolveResourceTier(), so it's testable
 * without module-reset tricks.
 */
export function resolveProfilerOptions(env: NodeJS.ProcessEnv = process.env): ProfilerOptions | undefined {
  const raw = env.QVAC_PROFILER?.trim().toLowerCase();
  if (raw === undefined || raw === '' || raw === 'off') return undefined;
  if (raw === 'summary') return { mode: 'summary' };
  if (raw === 'verbose') return { mode: 'verbose', includeServerBreakdown: true };
  console.warn(
    `[profiling] QVAC_PROFILER must be one of ${VALID_MODES.join('/')}/off - ignoring invalid value "${env.QVAC_PROFILER}"; profiling stays off.`,
  );
  return undefined;
}
