import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { PROFILER_ROUTE } from '../mountProfiler.js';
import type { ProfilerSnapshot } from '../domain/types.js';
import { imagePathFor, type BenchmarkQuestion } from './benchmarkQuestions.js';
import type { BenchResult, QuestionResult, VoiceResult } from './benchReport.js';
import { timeCompletionStream, timeVoiceStream } from './sseStream.js';

export interface ProfileBenchOptions {
  baseUrl: string;
  label?: string;
  questions: BenchmarkQuestion[];
  /** Root the vision questions' `pictures/...` paths resolve against. */
  corpusRoot: string;
  /** Optional WAV file for one voice turn (STT -> chat -> TTS). */
  audioFile?: string;
  readyTimeoutMs?: number;
  /** How long to wait for the server to accept connections at all (still booting) - shorter than readyTimeoutMs: models load slowly, but a server that never listens is a mistake to report fast. */
  connectTimeoutMs?: number;
  /** How often GET /health is polled while waiting for readiness. */
  pollIntervalMs?: number;
  log?: (line: string) => void;
}

export class ProfilerUnavailableError extends Error {}

const IMAGE_MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

const REQUEST_OPERATIONS = ['completionStream', 'transcribe', 'transcribeStream', 'textToSpeech', 'textToSpeechStream'];

export function isFreshStartup(startup: ProfilerSnapshot): boolean {
  return REQUEST_OPERATIONS.every((op) => (startup.operations[op]?.count ?? 0) === 0);
}

/**
 * Drives a running server the way a client does, and brackets the run with
 * the server's own profiler export: snapshot at readiness (startup model
 * loads), reset, the questions + optional voice turn, snapshot again
 * (steady state only). Requests run one at a time - this measures latency,
 * not throughput.
 */
export async function runProfileBench(options: ProfileBenchOptions): Promise<BenchResult> {
  const { baseUrl, log = () => {} } = options;
  const profilerUrl = `${baseUrl}${PROFILER_ROUTE}`;

  const readyTimeoutMs = options.readyTimeoutMs ?? 600_000;
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const deadline = Date.now() + readyTimeoutMs;

  // A server that is still booting (opening the vector store) refuses connections for a few seconds - keep trying until the deadline. A 404 is different: it IS up, just without QVAC_PROFILER, so fail at once.
  const connectDeadline = Math.min(deadline, Date.now() + (options.connectTimeoutMs ?? 60_000));
  const probe = await fetchUntilReachable(profilerUrl, connectDeadline, pollIntervalMs, log);
  if (probe.status === 404) {
    throw new ProfilerUnavailableError(`${PROFILER_ROUTE} answered 404: the server was started without QVAC_PROFILER. Restart it with QVAC_PROFILER=verbose (or summary).`);
  }

  await waitUntilReady(baseUrl, Math.max(0, deadline - Date.now()), pollIntervalMs, log);
  const startedAt = new Date().toISOString();
  const startup = await getSnapshot(profilerUrl);
  const freshStartup = isFreshStartup(startup);
  if (!freshStartup) log('warning: the server already served requests before this run - restart it for a clean startup snapshot.');
  const status = (await (await fetchOk(`${baseUrl}/api/chat/status`, 'GET /api/chat/status')).json()) as BenchResult['server'];
  const label = options.label ?? `${status.hardwareTier ?? 'run'}-${startedAt.slice(0, 10)}`;
  await fetchOk(`${profilerUrl}/reset`, `POST ${PROFILER_ROUTE}/reset`, { method: 'POST' });

  const questions: QuestionResult[] = [];
  for (const question of options.questions) {
    const result = await askQuestion(baseUrl, question, options.corpusRoot);
    questions.push(result);
    log(`[${label}] ${question.id} first=${(result.firstContentMs / 1000).toFixed(1)}s total=${(result.totalMs / 1000).toFixed(1)}s tools=${result.tools.join('|') || '-'}`);
  }

  const voice = options.audioFile ? await voiceTurn(baseUrl, options.audioFile) : undefined;
  if (voice) log(`[${label}] voice first-audio=${(voice.firstAudioMs / 1000).toFixed(1)}s total=${(voice.totalMs / 1000).toFixed(1)}s`);

  return {
    label,
    startedAt,
    server: { hardwareTier: status.hardwareTier, model: status.model, sttModel: status.sttModel, ttsModel: status.ttsModel },
    machine: {
      platform: os.platform(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      cpuCores: os.cpus().length,
      totalMemGB: Math.round(os.totalmem() / 1024 ** 3),
    },
    startup,
    freshStartup,
    steady: await getSnapshot(profilerUrl),
    questions,
    ...(voice ? { voice } : {}),
  };
}

async function fetchUntilReachable(url: string, deadline: number, pollIntervalMs: number, log: (line: string) => void): Promise<Response> {
  for (;;) {
    try {
      return await fetch(url);
    } catch (err) {
      if (Date.now() >= deadline) {
        throw new ProfilerUnavailableError(`Server not reachable at ${new URL(url).origin} (${String(err)}). Start it with QVAC_PROFILER=verbose.`);
      }
      log('waiting for the server to accept connections ...');
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }
}

async function fetchOk(url: string, what: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${what} failed: HTTP ${response.status} ${await response.text()}`);
  return response;
}

async function getSnapshot(profilerUrl: string): Promise<ProfilerSnapshot> {
  return (await (await fetchOk(`${profilerUrl}?events=true`, `GET ${PROFILER_ROUTE}`)).json()) as ProfilerSnapshot;
}

async function waitUntilReady(baseUrl: string, timeoutMs: number, pollIntervalMs: number, log: (line: string) => void): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const response = await fetch(`${baseUrl}/health`).catch(() => undefined);
    if (response?.status === 200) return;
    if (Date.now() >= deadline) throw new Error(`Server not ready after ${timeoutMs / 1000}s (GET /health never returned 200).`);
    log('waiting for GET /health -> 200 ...');
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function askQuestion(baseUrl: string, question: BenchmarkQuestion, corpusRoot: string): Promise<QuestionResult> {
  const image = imagePathFor(question);
  const content = image
    ? [
        { type: 'text', text: question.question },
        { type: 'image_url', image_url: { url: await toDataUrl(path.join(corpusRoot, image)) } },
      ]
    : question.question;

  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: true, messages: [{ role: 'user', content }] }),
  });
  if (!response.ok || !response.body) throw new Error(`Question ${question.id}: HTTP ${response.status} ${await response.text()}`);

  const timed = await timeCompletionStream(response.body as unknown as AsyncIterable<Uint8Array>, startedAt);
  return { id: question.id, question: question.question, expected: question.expected, ...(image ? { image } : {}), ...timed };
}

async function voiceTurn(baseUrl: string, audioFile: string): Promise<VoiceResult> {
  const audioBase64 = (await fs.readFile(audioFile)).toString('base64');
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/v1/chat/voice-completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ stream: true, messages: [], audioBase64 }),
  });
  if (!response.ok || !response.body) throw new Error(`Voice turn: HTTP ${response.status} ${await response.text()}`);

  const timed = await timeVoiceStream(response.body as unknown as AsyncIterable<Uint8Array>, startedAt);
  return { audioFile: path.basename(audioFile), ...timed };
}

async function toDataUrl(file: string): Promise<string> {
  const mime = IMAGE_MIME[path.extname(file).toLowerCase()];
  if (!mime) throw new Error(`Unsupported image extension: ${file}`);
  return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
}
