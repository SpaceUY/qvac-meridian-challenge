import type { OperationStats, ProfilerSnapshot } from '../domain/types.js';
import { summarizeLatencies, type LatencySummary } from './latencyStats.js';
import type { TimedCompletion, TimedVoiceTurn } from './sseStream.js';

export interface QuestionResult extends TimedCompletion {
  id: string;
  question: string;
  expected: string;
  image?: string;
}

export interface VoiceResult extends TimedVoiceTurn {
  audioFile: string;
}

export interface BenchResult {
  label: string;
  startedAt: string;
  server: { hardwareTier?: string; model?: unknown; sttModel?: unknown; ttsModel?: unknown };
  machine: { platform: string; arch: string; cpuModel: string; cpuCores: number; totalMemGB: number };
  /** Profiler export right after readiness: model loads only. */
  startup: ProfilerSnapshot;
  freshStartup: boolean;
  /** Profiler export after the questions (aggregates reset in between): steady-state requests only. */
  steady: ProfilerSnapshot;
  questions: QuestionResult[];
  voice?: VoiceResult;
}

/** Request/response (de)serialization sub-phases: sub-10ms each, kept in the JSON export but noise in a table meant to be read. */
const SERIALIZATION_KEY = /\.(?:request|response)\./;

const NOT_FRESH_STARTUP_NOTE =
  '> **Not a startup snapshot.** The server had already served requests before this run (it was not restarted), so this export holds them too. Restart the server for a clean startup snapshot; everything below this section belongs to this run.';

const seconds = (ms: number): string => (ms / 1000).toFixed(2);

function formatValue(value: number, unit: OperationStats['unit']): string {
  if (unit === 'ms') return value >= 1000 ? `${seconds(value)} s` : `${value.toFixed(1)} ms`;
  const rounded = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return unit === 'unknown' ? rounded : `${rounded} ${unit}`;
}

export function renderOperationsTable(snapshot: ProfilerSnapshot): string {
  const rows = Object.entries(snapshot.operations)
    .filter(([key]) => !SERIALIZATION_KEY.test(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([key, s]) =>
        `| \`${key}\` | ${s.count} | ${formatValue(s.min, s.unit)} | ${formatValue(s.avg, s.unit)} | ${formatValue(s.max, s.unit)} | ${s.unit === 'ms' ? formatValue(s.total, s.unit) : '-'} |`,
    );
  if (rows.length === 0) return '_No SDK operations recorded._';
  return ['| Operation | Count | Min | Avg | Max | Total |', '|---|---|---|---|---|---|', ...rows].join('\n');
}

/**
 * One row per worker-side `handler` event (verbose mode only): the SDK's
 * own per-request split between total handler time and model execution.
 * "Outside model execution" is the rest of the handler - for a completion,
 * KV-cache session setup/commit and anything else around the generation loop.
 */
export function renderHandlerEventsTable(snapshot: ProfilerSnapshot): string {
  const events = (snapshot.recentEvents ?? []).filter((e) => e.kind === 'handler' && e.ms !== undefined);
  if (events.length === 0) return '_No per-request handler events (run the server with QVAC_PROFILER=verbose)._';
  const cell = (value: number | undefined): string => (value === undefined ? '-' : seconds(value));
  const rows = events.map((e, i) => {
    const execution = e.gauges?.modelExecutionTime;
    const outside = execution === undefined ? undefined : e.ms! - execution;
    return `| ${i + 1} | \`${e.op}\` | ${cell(e.ms)} | ${cell(e.gauges?.ttfb)} | ${cell(execution)} | ${cell(outside)} |`;
  });
  return [
    '| # | Operation | Handler total (s) | Handler ttfb (s) | Model execution (s) | Outside model execution (s) |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

function latencyRow(name: string, s: LatencySummary): string {
  return `| ${name} | ${s.n} | ${seconds(s.min)} | ${seconds(s.p50)} | ${seconds(s.p90)} | ${seconds(s.max)} | ${seconds(s.mean)} |`;
}

const oneLine = (text: string, max = 140): string => {
  const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export function renderBenchReport(result: BenchResult): string {
  const { machine, server, questions, voice } = result;
  const lines: string[] = [
    `# Profiler benchmark - ${result.label}`,
    '',
    `- **Run:** ${result.startedAt}`,
    `- **Machine:** ${machine.cpuModel}, ${machine.cpuCores} cores, ${machine.totalMemGB} GB RAM (${machine.platform}/${machine.arch})`,
    `- **Hardware tier:** ${server.hardwareTier ?? 'unknown'} · **chat model:** ${JSON.stringify(server.model ?? null)}`,
    '',
    '## Startup (profiler export at readiness)',
    '',
    ...(result.freshStartup ? [] : [NOT_FRESH_STARTUP_NOTE, '']),
    renderOperationsTable(result.startup),
    '',
  ];

  if (questions.length > 0) {
    lines.push(
      `## Client-side latency, ${questions.length} questions via \`POST /v1/chat/completions\` (\`stream: true\`), seconds`,
      '',
      '| Metric | n | Min | p50 | p90 | Max | Mean |',
      '|---|---|---|---|---|---|---|',
      latencyRow('First visible token', summarizeLatencies(questions.map((q) => q.firstContentMs))),
      latencyRow('Full answer', summarizeLatencies(questions.map((q) => q.totalMs))),
      '',
      '| ID | First token (s) | Full (s) | Tools | Citations | Expected | Answer |',
      '|---|---|---|---|---|---|---|',
      ...questions.map(
        (q) =>
          `| ${q.id}${q.image ? ' (image)' : ''} | ${seconds(q.firstContentMs)} | ${seconds(q.totalMs)} | ${q.tools.join(', ') || '-'} | ${q.citations.length} | ${oneLine(q.expected, 80)} | ${oneLine(q.text)} |`,
      ),
      '',
    );
  }

  if (voice) {
    lines.push(
      '## Voice turn via `POST /v1/chat/voice-completions` (`stream: true`)',
      '',
      `- Audio in: \`${voice.audioFile}\` · transcript: "${oneLine(voice.transcript)}"`,
      `- First audio sentence: **${seconds(voice.firstAudioMs)} s** · full turn: **${seconds(voice.totalMs)} s** · ${voice.audioChunks} audio chunks${voice.error ? ` · **error: ${voice.error}**` : ''}`,
      '',
    );
  }

  lines.push(
    '## Steady state (profiler export after the requests above)',
    '',
    renderOperationsTable(result.steady),
    '',
    '`<op>.ttfb` aggregates two different measurements under one key: the client-side RPC phase and the worker-side handler gauge of the same name (the SDK keys both `op.ttfb`). The per-request table below keeps them apart.',
    '',
    '### Per request, worker side',
    '',
    renderHandlerEventsTable(result.steady),
    '',
  );
  return lines.join('\n');
}
