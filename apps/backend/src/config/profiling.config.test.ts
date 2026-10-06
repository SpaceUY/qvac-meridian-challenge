import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveProfilerOptions } from './profiling.config.js';

describe('resolveProfilerOptions', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is off (undefined) when QVAC_PROFILER is unset - the default `npm run serve` gets no profiler and no debug route', () => {
    expect(resolveProfilerOptions({})).toBeUndefined();
  });

  it.each(['', '   ', 'off', 'OFF'])('is off for %j, silently - a valid way to say "off" is not a misconfiguration', (value) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveProfilerOptions({ QVAC_PROFILER: value })).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('summary: aggregates only, no worker-side breakdown', () => {
    expect(resolveProfilerOptions({ QVAC_PROFILER: 'summary' })).toEqual({ mode: 'summary' });
  });

  it('verbose: raw events plus the worker-side breakdown', () => {
    expect(resolveProfilerOptions({ QVAC_PROFILER: 'verbose' })).toEqual({ mode: 'verbose', includeServerBreakdown: true });
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveProfilerOptions({ QVAC_PROFILER: '  Verbose ' })).toEqual({ mode: 'verbose', includeServerBreakdown: true });
  });

  it('warns and stays off on an invalid value instead of crashing startup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(resolveProfilerOptions({ QVAC_PROFILER: 'true' })).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('"true"');
  });
});
