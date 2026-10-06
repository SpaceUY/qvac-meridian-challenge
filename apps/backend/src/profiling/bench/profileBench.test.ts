import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mountProfiler } from '../mountProfiler.js';
import type { ProfilerPort } from '../domain/ports.js';
import type { ProfilerSnapshot } from '../domain/types.js';
import { ProfilerUnavailableError, isFreshStartup, runProfileBench } from './profileBench.js';

/**
 * End to end over real HTTP: runProfileBench() against an in-process Express
 * app that mounts the REAL profiler router (via mountProfiler) on a fake
 * ProfilerPort, plus fake /health, /api/chat/status, completions and voice
 * routes. Checks the order of operations a real run depends on - export
 * at readiness, reset, requests, export again - not just the happy output.
 */
describe('runProfileBench', () => {
  let server: http.Server | undefined;
  let tmpDir: string;
  let calls: string[];
  let requestBodies: Record<string, unknown>[];

  beforeEach(() => {
    calls = [];
    requestBodies = [];
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'profile-bench-'));
    fs.mkdirSync(path.join(tmpDir, 'pictures'));
    fs.writeFileSync(path.join(tmpDir, 'pictures', 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(tmpDir, 'turn.wav'), Buffer.from('RIFF....WAVE'));
  });

  afterEach(() => {
    server?.close();
    server = undefined;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function fakeProfiler(servedBefore = false): ProfilerPort {
    let phase = 'startup';
    return {
      enable: () => calls.push('enable'),
      reset: () => {
        calls.push('reset');
        phase = 'steady';
      },
      getSnapshot: (options) => {
        calls.push(`snapshot(events=${String(options?.includeRecentEvents)})`);
        const stats = { unit: 'ms', count: 1, min: 1, max: 1, avg: 1, total: 1, last: 1 } as const;
        const snapshot: ProfilerSnapshot = {
          enabled: true,
          mode: 'verbose',
          exportedAt: calls.length,
          operations:
            phase === 'startup'
              ? { loadModel: stats, ...(servedBefore ? { completionStream: stats } : {}) }
              : { completionStream: stats },
        };
        return snapshot;
      },
    };
  }

  async function startFakeServer(
    opts: { profiler?: boolean; servedBefore?: boolean; notReadyPolls?: number; port?: number; failReset?: boolean; failStatus?: boolean } = {},
  ): Promise<string> {
    const app = express();
    app.use(express.json({ limit: '5mb' }));
    if (opts.failReset) app.post('/api/debug/profiler/reset', (_req, res) => res.status(500).json({ error: 'boom' }));
    if (opts.failStatus) app.get('/api/chat/status', (_req, res) => res.status(503).json({ error: 'not ready' }));
    if (opts.profiler !== false) mountProfiler(app, { mode: 'verbose' }, () => fakeProfiler(opts.servedBefore));

    let polls = 0;
    app.get('/health', (_req, res) => {
      polls += 1;
      calls.push('health');
      res.status(polls > (opts.notReadyPolls ?? 0) ? 200 : 503).end();
    });
    app.get('/api/chat/status', (_req, res) => {
      res.json({ status: 'ready', hardwareTier: 'medium', model: { name: 'fake-9B' }, sttModel: 'stt', ttsModel: 'tts' });
    });
    app.post('/v1/chat/completions', (req, res) => {
      calls.push('completion');
      requestBodies.push(req.body as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const delta = (d: Record<string, unknown>) => res.write(`data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`);
      delta({ role: 'assistant' });
      delta({ content: 'answer' });
      delta({ tools: [] });
      delta({ citations: [{ file: 'doc.md', score: 0.9 }] });
      res.end('data: [DONE]\n\n');
    });
    app.post('/v1/chat/voice-completions', (req, res) => {
      calls.push('voice');
      requestBodies.push(req.body as Record<string, unknown>);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ type: 'audio', text: 'Four hours.', audioBase64: 'AAA=' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done', transcript: 'p1 sla?' })}\n\n`);
      res.end('data: [DONE]\n\n');
    });

    server = app.listen(opts.port ?? 0);
    await new Promise<void>((resolve) => server!.once('listening', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  const QUESTIONS = [
    { id: '001', question: 'What is X?', expected: '72', source: 'data/a.json' },
    { id: '204', question: 'What PPE?', expected: 'hat', source: 'pictures/pic.png' },
  ];

  it('snapshots at readiness, resets, runs every question, then snapshots the steady state - in that order', async () => {
    const baseUrl = await startFakeServer();

    const result = await runProfileBench({ baseUrl, label: 't', questions: QUESTIONS, corpusRoot: tmpDir });

    expect(calls.filter((c) => c !== 'health')).toEqual([
      'enable',
      'snapshot(events=false)', // the 404 probe
      'snapshot(events=true)', // startup
      'reset',
      'completion',
      'completion',
      'snapshot(events=true)', // steady
    ]);
    expect(Object.keys(result.startup.operations)).toEqual(['loadModel']);
    expect(Object.keys(result.steady.operations)).toEqual(['completionStream']);
    expect(result.freshStartup).toBe(true);
  });

  it('flags the startup export as not fresh when the server had already served requests (not restarted)', async () => {
    const result = await runProfileBench({ baseUrl: await startFakeServer({ servedBefore: true }), label: 't', questions: [], corpusRoot: tmpDir });

    expect(result.freshStartup).toBe(false);
  });

  it('without a label, names the run after the server tier and date - the same name the logs use', async () => {
    const lines: string[] = [];

    const result = await runProfileBench({ baseUrl: await startFakeServer(), questions: QUESTIONS.slice(0, 1), corpusRoot: tmpDir, log: (line) => lines.push(line) });

    expect(result.label).toBe(`medium-${result.startedAt.slice(0, 10)}`);
    expect(lines.some((line) => line.startsWith(`[${result.label}] 001`))).toBe(true);
  });

  it('stops before sending any question when the profiler reset fails, instead of mixing startup into the steady state', async () => {
    const baseUrl = await startFakeServer({ failReset: true });

    await expect(runProfileBench({ baseUrl, label: 't', questions: QUESTIONS, corpusRoot: tmpDir })).rejects.toThrow(/reset.*HTTP 500/);
    expect(calls).not.toContain('completion');
  });

  it('stops with a clear error when GET /api/chat/status fails', async () => {
    const baseUrl = await startFakeServer({ failStatus: true });

    await expect(runProfileBench({ baseUrl, label: 't', questions: QUESTIONS, corpusRoot: tmpDir })).rejects.toThrow(/status.*HTTP 503/);
    expect(calls).not.toContain('completion');
  });

  it('records each question\'s timings, answer and citations, plus the server tier and model', async () => {
    const result = await runProfileBench({ baseUrl: await startFakeServer(), label: 't', questions: QUESTIONS, corpusRoot: tmpDir });

    expect(result.server).toEqual({ hardwareTier: 'medium', model: { name: 'fake-9B' }, sttModel: 'stt', ttsModel: 'tts' });
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]).toMatchObject({ id: '001', text: 'answer', citations: ['doc.md'], expected: '72' });
    expect(result.questions[0]!.totalMs).toBeGreaterThanOrEqual(result.questions[0]!.firstContentMs);
    expect(result.machine.cpuCores).toBeGreaterThan(0);
  });

  it('sends text questions as a plain string and vision questions with the corpus image as a data URL', async () => {
    const result = await runProfileBench({ baseUrl: await startFakeServer(), label: 't', questions: QUESTIONS, corpusRoot: tmpDir });

    expect(requestBodies[0]).toEqual({ stream: true, messages: [{ role: 'user', content: 'What is X?' }] });
    expect(requestBodies[1]).toEqual({
      stream: true,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What PPE?' },
            { type: 'image_url', image_url: { url: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}` } },
          ],
        },
      ],
    });
    expect(result.questions[1]?.image).toBe('pictures/pic.png');
  });

  it('runs one voice turn when given an audio file, sending it as base64', async () => {
    const result = await runProfileBench({
      baseUrl: await startFakeServer(),
      label: 't',
      questions: [],
      corpusRoot: tmpDir,
      audioFile: path.join(tmpDir, 'turn.wav'),
    });

    expect(requestBodies[0]).toEqual({ stream: true, messages: [], audioBase64: Buffer.from('RIFF....WAVE').toString('base64') });
    expect(result.voice).toMatchObject({ audioFile: 'turn.wav', transcript: 'p1 sla?', answer: 'Four hours.', audioChunks: 1 });
  });

  it('waits for GET /health to return 200 before taking the startup snapshot', async () => {
    const baseUrl = await startFakeServer({ notReadyPolls: 2 });

    await runProfileBench({ baseUrl, label: 't', questions: [], corpusRoot: tmpDir, pollIntervalMs: 5 });

    const healthPolls = calls.filter((c) => c === 'health').length;
    expect(healthPolls).toBe(3);
    expect(calls.indexOf('snapshot(events=true)')).toBeGreaterThan(calls.lastIndexOf('health'));
  });

  it('gives up with a clear error when the server never becomes ready', async () => {
    const baseUrl = await startFakeServer({ notReadyPolls: Infinity });

    await expect(
      runProfileBench({ baseUrl, label: 't', questions: [], corpusRoot: tmpDir, readyTimeoutMs: 20, pollIntervalMs: 5 }),
    ).rejects.toThrow(/not ready/);
  });

  it('fails fast with ProfilerUnavailableError when the server runs without QVAC_PROFILER (route 404)', async () => {
    const baseUrl = await startFakeServer({ profiler: false });

    await expect(runProfileBench({ baseUrl, label: 't', questions: QUESTIONS, corpusRoot: tmpDir })).rejects.toThrow(ProfilerUnavailableError);
    expect(calls).not.toContain('completion');
  });

  it('fails with ProfilerUnavailableError when nothing ever listens at the base URL', async () => {
    await expect(
      runProfileBench({ baseUrl: 'http://127.0.0.1:1', label: 't', questions: [], corpusRoot: tmpDir, readyTimeoutMs: 30, pollIntervalMs: 5 }),
    ).rejects.toThrow(ProfilerUnavailableError);
  });

  it('gives up on connecting after connectTimeoutMs even when readyTimeoutMs is much longer', async () => {
    const started = Date.now();

    await expect(
      runProfileBench({ baseUrl: 'http://127.0.0.1:1', label: 't', questions: [], corpusRoot: tmpDir, readyTimeoutMs: 60_000, connectTimeoutMs: 40, pollIntervalMs: 5 }),
    ).rejects.toThrow(/not reachable/);
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('waits for a server that starts listening only after the benchmark started (booting)', async () => {
    // Reserve a free port, release it, start the bench against it, and only then start the server there.
    const probe = http.createServer().listen(0);
    await new Promise<void>((resolve) => probe.once('listening', resolve));
    const { port } = probe.address() as AddressInfo;
    await new Promise<void>((resolve) => probe.close(() => resolve()));

    const run = runProfileBench({ baseUrl: `http://127.0.0.1:${port}`, label: 't', questions: [], corpusRoot: tmpDir, pollIntervalMs: 10 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await startFakeServer({ port });

    await expect(run).resolves.toMatchObject({ label: 't' });
  });
});

describe('isFreshStartup', () => {
  const stats = { unit: 'ms', count: 1, min: 1, max: 1, avg: 1, total: 1, last: 1 } as const;
  const snapshot = (operations: ProfilerSnapshot['operations']): ProfilerSnapshot => ({ enabled: true, mode: 'verbose', exportedAt: 1, operations });

  it('accepts what a fresh server records before readiness: model loads, the RPC connection, an embedding warm-up', () => {
    expect(isFreshStartup(snapshot({ loadModel: stats, 'rpc.connection': stats, embed: stats }))).toBe(true);
  });

  it.each(['completionStream', 'transcribe', 'textToSpeech'])('rejects a startup export that already holds a %s request', (op) => {
    expect(isFreshStartup(snapshot({ loadModel: stats, [op]: stats }))).toBe(false);
  });
});
