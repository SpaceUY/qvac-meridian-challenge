import { profiler } from '@qvac/sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { QvacProfilerAdapter } from './qvacProfilerAdapter.js';

/**
 * No vi.mock here, unlike qvacProfilerAdapter.test.ts: this file runs the
 * adapter against the installed @qvac/sdk's real profiler, so a change in
 * the SDK's exportJSON()/clear() behavior fails a test instead of silently
 * turning snapshot fields into `undefined`. The profiler is client-side
 * state in this process - enable()/exportJSON() never start the QVAC worker.
 */
describe('QvacProfilerAdapter against the real SDK profiler', () => {
  afterEach(() => {
    profiler.disable();
    profiler.clear();
  });

  it('getSnapshot() reports enabled: false while the profiler was never enabled', () => {
    expect(new QvacProfilerAdapter().getSnapshot().enabled).toBe(false);
  });

  it.each(['summary', 'verbose'] as const)('enable({ mode: %s }) turns the real SDK profiler on in that mode', (mode) => {
    const adapter = new QvacProfilerAdapter();
    adapter.enable({ mode });

    expect(profiler.isEnabled()).toBe(true);
    expect(adapter.getSnapshot().mode).toBe(mode);
  });

  it('enable() passes includeServerBreakdown through to the real SDK config (verbose mode relies on it)', () => {
    const adapter = new QvacProfilerAdapter();

    adapter.enable({ mode: 'verbose', includeServerBreakdown: true });
    expect(profiler.getConfig().includeServerBreakdown).toBe(true);

    adapter.enable({ mode: 'summary' });
    expect(profiler.getConfig().includeServerBreakdown).toBe(false);
  });

  it('getSnapshot() reads the real export: enabled, a numeric timestamp, and no operations before any SDK call', () => {
    const adapter = new QvacProfilerAdapter();
    adapter.enable({ mode: 'summary' });

    const snapshot = adapter.getSnapshot();

    expect(snapshot.enabled).toBe(true);
    expect(typeof snapshot.exportedAt).toBe('number');
    expect(snapshot.operations).toEqual({});
  });

  it('getSnapshot({ includeRecentEvents: true }) returns an array from the real SDK', () => {
    const adapter = new QvacProfilerAdapter();
    adapter.enable({ mode: 'verbose' });

    expect(adapter.getSnapshot({ includeRecentEvents: true }).recentEvents).toEqual([]);
  });

  it('reset() keeps the profiler enabled - it only clears data', () => {
    const adapter = new QvacProfilerAdapter();
    adapter.enable({ mode: 'summary' });

    adapter.reset();

    expect(adapter.getSnapshot().enabled).toBe(true);
  });
});
