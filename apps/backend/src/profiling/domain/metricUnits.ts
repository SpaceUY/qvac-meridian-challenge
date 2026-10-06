import type { MetricUnit } from './types.js';

/**
 * Units of the non-duration gauges `@qvac/sdk@0.18.2` aggregates next to its
 * timings (`server/rpc/profiling/operation-metrics.js`, load-model handler).
 * Every other aggregate key is a duration in ms: a plain op (`loadModel`), a
 * phase (`loadModel.serverWait`) or a timing gauge (`...modelExecutionTime`,
 * `...timeToFirstToken`, `...ttfb`).
 */
const NON_DURATION_UNITS: Readonly<Record<string, MetricUnit>> = {
  tokensPerSecond: 'tokens/s',
  cacheTokens: 'tokens',
  totalTokens: 'tokens',
  realTimeFactor: 'ratio',
  totalSegments: 'count',
  totalSamples: 'samples',
  totalBytesDownloaded: 'bytes',
  downloadSpeedBps: 'bytes/s',
  // Nothing in the SDK's typings says which unit; only verified per op below.
  audioDuration: 'unknown',
};

/**
 * Per-operation overrides, each verified against a real capture: TTS's
 * `audioDuration` equals `totalSamples / 44_100 * 1000` (Supertonic's
 * SUPERTONIC_SAMPLE_RATE), i.e. ms. Transcription's is left `unknown`.
 */
const OPERATION_UNITS: Readonly<Record<string, MetricUnit>> = {
  'textToSpeech.audioDuration': 'ms',
  'textToSpeechStream.audioDuration': 'ms',
};

/** The unit of one aggregate key: a verified per-operation override first, else by its last dot-separated segment (the gauge name, when there is one). */
export function unitForMetric(key: string): MetricUnit {
  const segments = key.split('.');
  const opAndGauge = segments.slice(-2).join('.');
  return OPERATION_UNITS[opAndGauge] ?? NON_DURATION_UNITS[segments[segments.length - 1]!] ?? 'ms';
}
