import { cancel, textToSpeech } from '@qvac/sdk';
import type { TextToSpeechPort } from '../domain/ports.js';
import type { SynthesisResult } from '../domain/types.js';
import { SUPERTONIC_SAMPLE_RATE } from '../../config/models.config.js';
import { pcmToWav } from './wavEncode.js';

/** Only file in this feature that imports @qvac/sdk. */
export class QvacTtsAdapter implements TextToSpeechPort {
  async synthesize(modelId: string, text: string): Promise<SynthesisResult> {
    const result = textToSpeech({ modelId, text, inputType: 'text', stream: false });
    const samples = await result.buffer;
    return { audio: pcmToWav(samples, SUPERTONIC_SAMPLE_RATE), sampleRate: SUPERTONIC_SAMPLE_RATE };
  }

  /** Broad-cancel: textToSpeech() has no requestId to target a single call. */
  async cancel(modelId: string): Promise<void> {
    await cancel({ modelId, kind: 'tts' });
  }
}
