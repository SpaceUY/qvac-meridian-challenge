import { beforeEach, describe, expect, it, vi } from 'vitest';

const { enableMock, exportJSONMock, clearMock } = vi.hoisted(() => ({
  enableMock: vi.fn(),
  exportJSONMock: vi.fn(),
  clearMock: vi.fn(),
}));

// Same pattern as models/infra/qvacProviderAdapter.test.ts: mock only the
// SDK functions this adapter touches, keep everything else real.
vi.mock('@qvac/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@qvac/sdk')>();
  return {
    ...actual,
    profiler: { ...actual.profiler, enable: enableMock, exportJSON: exportJSONMock, clear: clearMock },
  };
});

const { QvacProfilerAdapter } = await import('./qvacProfilerAdapter.js');

const CONFIG = {
  enabled: true,
  mode: 'summary',
  includeServerBreakdown: false,
  includeResourceGauges: false,
  operationFilters: [],
  maxRecentEvents: 1000,
};

function sdkExport(overrides: Record<string, unknown> = {}) {
  return { config: CONFIG, aggregates: {}, exportedAt: 1234, ...overrides };
}

describe('QvacProfilerAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enable() forwards the options as-is to the SDK profiler', () => {
    new QvacProfilerAdapter().enable({ mode: 'verbose' });

    expect(enableMock).toHaveBeenCalledWith({ mode: 'verbose' });
  });

  it('reset() clears the SDK profiler', () => {
    new QvacProfilerAdapter().reset();

    expect(clearMock).toHaveBeenCalledOnce();
  });

  it('getSnapshot() translates the SDK export into the domain shape, with `sum` renamed to `total` and a unit per key', () => {
    exportJSONMock.mockReturnValue(
      sdkExport({ aggregates: { loadModel: { count: 2, min: 10, max: 30, avg: 20, sum: 40, last: 30 } } }),
    );

    expect(new QvacProfilerAdapter().getSnapshot()).toEqual({
      enabled: true,
      mode: 'summary',
      exportedAt: 1234,
      operations: { loadModel: { unit: 'ms', count: 2, min: 10, max: 30, avg: 20, total: 40, last: 30 } },
    });
  });

  it('getSnapshot() labels gauges with their own unit - tokens/s is not ms', () => {
    exportJSONMock.mockReturnValue(
      sdkExport({
        aggregates: {
          'completionStream.modelExecutionTime': { count: 1, min: 900, max: 900, avg: 900, sum: 900, last: 900 },
          'completionStream.tokensPerSecond': { count: 1, min: 15, max: 15, avg: 15, sum: 15, last: 15 },
          'completionStream.cacheTokens': { count: 1, min: 800, max: 800, avg: 800, sum: 800, last: 800 },
        },
      }),
    );

    const { operations } = new QvacProfilerAdapter().getSnapshot();

    expect(operations['completionStream.modelExecutionTime']?.unit).toBe('ms');
    expect(operations['completionStream.tokensPerSecond']?.unit).toBe('tokens/s');
    expect(operations['completionStream.cacheTokens']?.unit).toBe('tokens');
  });

  it('getSnapshot() returns an empty operations map when nothing has been recorded yet', () => {
    exportJSONMock.mockReturnValue(sdkExport());

    expect(new QvacProfilerAdapter().getSnapshot().operations).toEqual({});
  });

  it('getSnapshot() does not ask the SDK for recent events, and omits the field, unless requested', () => {
    exportJSONMock.mockReturnValue(sdkExport());

    const snapshot = new QvacProfilerAdapter().getSnapshot();

    expect(exportJSONMock).toHaveBeenCalledWith({ includeRecentEvents: false });
    expect(snapshot).not.toHaveProperty('recentEvents');
  });

  it('getSnapshot({ includeRecentEvents: true }) maps each event, keeping its profile id (groups the events of one request) and dropping resource/backend diagnostics', () => {
    exportJSONMock.mockReturnValue(
      sdkExport({
        recentEvents: [
          {
            ts: 5,
            op: 'completionStream',
            kind: 'handler',
            profileId: 'p-1',
            ms: 900,
            gauges: { tokensPerSecond: 15 },
            tags: { modelId: 'm1' },
            resources: { cpu: { value: 1 } },
            backend: { device: 'gpu' },
          },
          { ts: 6, op: 'rpc', kind: 'rpc', phase: 'connection', ms: 3 },
        ],
      }),
    );

    const snapshot = new QvacProfilerAdapter().getSnapshot({ includeRecentEvents: true });

    expect(exportJSONMock).toHaveBeenCalledWith({ includeRecentEvents: true });
    expect(snapshot.recentEvents).toEqual([
      { ts: 5, op: 'completionStream', kind: 'handler', profileId: 'p-1', ms: 900, gauges: { tokensPerSecond: 15 }, tags: { modelId: 'm1' } },
      { ts: 6, op: 'rpc', kind: 'rpc', phase: 'connection', ms: 3 },
    ]);
  });

  it('getSnapshot({ includeRecentEvents: true }) returns an empty list when the SDK kept none (summary mode)', () => {
    exportJSONMock.mockReturnValue(sdkExport());

    expect(new QvacProfilerAdapter().getSnapshot({ includeRecentEvents: true }).recentEvents).toEqual([]);
  });
});
