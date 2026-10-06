import { describe, expect, it } from 'vitest';
import { renderBenchReport, renderHandlerEventsTable, renderOperationsTable, type BenchResult } from './benchReport.js';
import type { ProfilerSnapshot } from '../domain/types.js';

const stats = (unit: 'ms' | 'tokens/s', value: number) => ({ unit, count: 2, min: value, max: value, avg: value, total: value * 2, last: value });

const STEADY: ProfilerSnapshot = {
  enabled: true,
  mode: 'verbose',
  exportedAt: 2,
  operations: {
    completionStream: stats('ms', 12_345),
    'completionStream.tokensPerSecond': stats('tokens/s', 15.5),
    'completionStream.request.zodValidation': stats('ms', 0.4),
  },
};

const RESULT: BenchResult = {
  label: 'medium',
  startedAt: '2026-10-06T00:00:00.000Z',
  server: { hardwareTier: 'medium', model: { name: 'Qwen3.5-9B' } },
  machine: { platform: 'darwin', arch: 'arm64', cpuModel: 'Apple M4', cpuCores: 10, totalMemGB: 16 },
  startup: { enabled: true, mode: 'verbose', exportedAt: 1, operations: { loadModel: stats('ms', 4967) } },
  freshStartup: true,
  steady: STEADY,
  questions: [
    { id: '001', question: 'Q1', expected: '72', firstContentMs: 1000, totalMs: 3000, text: 'It is 72.', tools: [], citations: ['a.json'] },
    { id: '204', question: 'Q2', expected: 'hat | vest', image: 'pictures/pic2.png', firstContentMs: 2000, totalMs: 5000, text: 'A blue\nhard hat', tools: ['list_documents'], citations: [] },
  ],
};

describe('renderOperationsTable', () => {
  it('formats durations in s/ms and gauges in their own unit, and hides serialization sub-phases', () => {
    const table = renderOperationsTable(STEADY);

    expect(table).toContain('| `completionStream` | 2 | 12.35 s | 12.35 s | 12.35 s | 24.69 s |');
    expect(table).toContain('| `completionStream.tokensPerSecond` | 2 | 15.50 tokens/s | 15.50 tokens/s | 15.50 tokens/s | - |');
    expect(table).not.toContain('zodValidation');
  });

  it('says so when nothing was recorded', () => {
    expect(renderOperationsTable({ ...STEADY, operations: {} })).toBe('_No SDK operations recorded._');
  });
});

describe('renderHandlerEventsTable', () => {
  it('lists only worker-side handler events, splitting model execution from the rest of the handler', () => {
    const table = renderHandlerEventsTable({
      ...STEADY,
      recentEvents: [
        { ts: 1, op: 'completionStream', kind: 'rpc', phase: 'ttfb', ms: 9000 },
        { ts: 2, op: 'completionStream', kind: 'handler', ms: 27_000, gauges: { ttfb: 13_500, modelExecutionTime: 17_000 } },
        { ts: 3, op: 'transcribeStream', kind: 'handler', ms: 800 },
      ],
    });

    expect(table).toContain('| 1 | `completionStream` | 27.00 | 13.50 | 17.00 | 10.00 |');
    expect(table).toContain('| 2 | `transcribeStream` | 0.80 | - | - | - |');
    expect(table).not.toContain('9.00');
  });

  it('explains how to get the data when there are no events (summary mode)', () => {
    expect(renderHandlerEventsTable(STEADY)).toContain('QVAC_PROFILER=verbose');
  });
});

describe('renderBenchReport', () => {
  const report = renderBenchReport(RESULT);

  it('states the run conditions: machine, tier and model', () => {
    expect(report).toContain('Apple M4, 10 cores, 16 GB RAM (darwin/arm64)');
    expect(report).toContain('**Hardware tier:** medium');
    expect(report).toContain('Qwen3.5-9B');
  });

  it('includes both profiler exports: startup and steady state', () => {
    expect(report).toContain('## Startup');
    expect(report).toContain('`loadModel`');
    expect(report).toContain('## Steady state');
  });

  it('flags a startup export taken on a server that had already served requests, and only then', () => {
    expect(report).not.toContain('Not a startup snapshot');
    expect(renderBenchReport({ ...RESULT, freshStartup: false })).toContain('> **Not a startup snapshot.**');
  });

  it('summarizes client latencies with percentiles, in seconds', () => {
    expect(report).toContain('| First visible token | 2 | 1.00 | 1.00 | 2.00 | 2.00 | 1.50 |');
    expect(report).toContain('| Full answer | 2 | 3.00 | 3.00 | 5.00 | 5.00 | 4.00 |');
  });

  it('lists every question on one table row: newlines flattened, pipes escaped, image questions marked', () => {
    expect(report).toContain('| 204 (image) | 2.00 | 5.00 | list_documents | 0 | hat \\| vest | A blue hard hat |');
  });

  it('omits the voice section when no voice turn ran', () => {
    expect(report).not.toContain('voice-completions');
  });

  it('includes the voice turn when there is one, with its error if it failed', () => {
    const withVoice = renderBenchReport({
      ...RESULT,
      voice: { audioFile: 'turn.wav', firstAudioMs: 4000, totalMs: 9000, transcript: 'hi', answer: 'hello', audioChunks: 0, error: 'boom' },
    });

    expect(withVoice).toContain('First audio sentence: **4.00 s** · full turn: **9.00 s** · 0 audio chunks · **error: boom**');
  });
});
