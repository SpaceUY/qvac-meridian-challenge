import { transcribe, transcribeStream } from '@qvac/sdk';
import type { SpeechTranscriptionPort } from '../domain/ports.js';
import type { AudioInput, StreamTranscriptSession, TranscribeOptions, TranscriptionResult } from '../domain/types.js';
import { wrapStreamSession } from './streamSession.js';

/** The only file in this feature allowed to import `@qvac/sdk` (same boundary as `models/infra/qvacRuntimeAdapter.ts`). */
export class QvacTranscriptionAdapter implements SpeechTranscriptionPort {
  async transcribe(modelId: string, audio: AudioInput, options?: TranscribeOptions): Promise<TranscriptionResult> {
    const text = await transcribe({
      modelId,
      audioChunk: audio.kind === 'filePath' ? audio.path : audio.data,
      prompt: options?.prompt
    });
    return { text };
  }

  /** The no-`audioChunk` overload: resolves a `TranscribeStreamSession`, not the deprecated upfront-audio generator. */
  async transcribeStream(modelId: string): Promise<StreamTranscriptSession> {
    const session = await transcribeStream({ modelId });
    return wrapStreamSession(session);
  }
}
