import { cancel, textToSpeech } from '@qvac/sdk';
import type { TextToSpeechPort } from '../domain/ports.js';
import type { SynthesisOptions, SynthesisResult } from '../domain/types.js';
import { SUPERTONIC_MAX_CHUNK_CHARS, SUPERTONIC_SAMPLE_RATE } from '../../config/models.config.js';
import { pcmToWav } from './wavEncode.js';

/** Whitespace right after a sentence end - where one engine job may end and the next begin. */
const SENTENCE_BOUNDARY_RE = /(?<=[.!?])\s+/;

/** Only file in this feature that imports @qvac/sdk. */
export class QvacTtsAdapter implements TextToSpeechPort {
  /**
   * Synthesizes `text` as a series of engine jobs of whole sentences, at
   * most SUPERTONIC_MAX_CHUNK_CHARS each where sentences allow it, joined
   * into one WAV. A job can't be stopped once started - the SDK's
   * `cancel({ kind: 'tts' })` matches nothing in 0.18.2, and leaving the
   * stream early doesn't stop the worker either - so `signal` is checked
   * between jobs: a stopped synthesis wastes at most the job in flight.
   */
  async synthesize(modelId: string, text: string, options: SynthesisOptions = {}): Promise<SynthesisResult> {
    const pieces: number[][] = [];
    for (const job of toJobs(text, SUPERTONIC_MAX_CHUNK_CHARS)) {
      options.signal?.throwIfAborted();
      pieces.push(await synthesizeJob(modelId, job));
    }
    return { audio: pcmToWav(pieces.flat(), SUPERTONIC_SAMPLE_RATE), sampleRate: SUPERTONIC_SAMPLE_RATE };
  }

  /** Broad-cancel: textToSpeech() has no requestId to target a single call. */
  async cancel(modelId: string): Promise<void> {
    await cancel({ modelId, kind: 'tts' });
  }
}

/**
 * Packs whole sentences into jobs of at most `maxChars`. A sentence longer
 * than that is a job of its own - sentenceStream still splits it inside
 * the engine, since one long job runs into Supertonic's ~28 s output cap.
 */
export function toJobs(text: string, maxChars: number): string[] {
  const jobs: string[] = [];
  for (const sentence of text.split(SENTENCE_BOUNDARY_RE)) {
    if (!sentence.trim()) continue;
    const last = jobs.at(-1);
    if (last !== undefined && last.length + 1 + sentence.length <= maxChars) {
      jobs[jobs.length - 1] = `${last} ${sentence}`;
    } else {
      jobs.push(sentence);
    }
  }
  return jobs;
}

/** One engine job. The SDK only allows sentenceStream with `stream: true`, so the job's chunks are joined here. */
async function synthesizeJob(modelId: string, text: string): Promise<number[]> {
  const result = textToSpeech({
    modelId,
    text,
    inputType: 'text',
    stream: true,
    sentenceStream: true,
    sentenceStreamMaxChunkScalars: SUPERTONIC_MAX_CHUNK_CHARS,
  });
  if (!result.chunkUpdates) {
    throw new Error('textToSpeech returned no chunkUpdates for a sentenceStream request');
  }
  return collectSamples(result.chunkUpdates);
}

/** Joins each chunk's samples in order. Flattened once at the end: spreading ~1M samples into push() overflows the call stack. */
async function collectSamples(chunks: AsyncIterable<{ buffer: number[] }>): Promise<number[]> {
  const pieces: number[][] = [];
  for await (const chunk of chunks) pieces.push(chunk.buffer);
  return pieces.flat();
}
