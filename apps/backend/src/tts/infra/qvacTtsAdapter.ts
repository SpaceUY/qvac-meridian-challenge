import { cancel, textToSpeech } from '@qvac/sdk';
import type { TextToSpeechPort } from '../domain/ports.js';
import type { SynthesisResult } from '../domain/types.js';
import { SUPERTONIC_MAX_CHUNK_CHARS, SUPERTONIC_SAMPLE_RATE } from '../../config/models.config.js';
import { pcmToWav } from './wavEncode.js';

/** Only file in this feature that imports @qvac/sdk. */
export class QvacTtsAdapter implements TextToSpeechPort {
  /**
   * Has the SDK split `text` into chunks of at most SUPERTONIC_MAX_CHUNK_CHARS,
   * each synthesized as its own job - one long job runs into Supertonic's
   * ~28 s output cap. The SDK only allows that mode with `stream: true`,
   * so the chunks are joined back into one WAV here.
   */
  async synthesize(modelId: string, text: string): Promise<SynthesisResult> {
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
    const samples = await collectSamples(result.chunkUpdates);
    return { audio: pcmToWav(samples, SUPERTONIC_SAMPLE_RATE), sampleRate: SUPERTONIC_SAMPLE_RATE };
  }

  /** Broad-cancel: textToSpeech() has no requestId to target a single call. */
  async cancel(modelId: string): Promise<void> {
    await cancel({ modelId, kind: 'tts' });
  }
}

/** Joins each chunk's samples in order. Flattened once at the end: spreading ~1M samples into push() overflows the call stack. */
async function collectSamples(chunks: AsyncIterable<{ buffer: number[] }>): Promise<number[]> {
  const pieces: number[][] = [];
  for await (const chunk of chunks) pieces.push(chunk.buffer);
  return pieces.flat();
}
