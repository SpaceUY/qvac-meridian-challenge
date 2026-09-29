import { transcribe, transcribeStream } from '@qvac/sdk';
import type { SpeechTranscriptionPort } from '../domain/ports.js';
import type { AudioInput, StreamTranscriptSession, TranscribeOptions, TranscriptionResult } from '../domain/types.js';
import { wrapStreamSession } from './streamSession.js';

/**
 * The only file in this feature that imports `@qvac/sdk`. Translates
 * between the domain types in `../domain` and the SDK's own
 * `transcribe()`/`transcribeStream()` shapes, mirroring the same boundary
 * `models/infra/qvacRuntimeAdapter.ts` keeps for the completion engine.
 */
export class QvacTranscriptionAdapter implements SpeechTranscriptionPort {
  async transcribe(modelId: string, audio: AudioInput, options?: TranscribeOptions): Promise<TranscriptionResult> {
    const text = await transcribe({
      modelId,
      audioChunk: audio.kind === 'filePath' ? audio.path : audio.data,
      prompt: options?.prompt
    });
    return { text };
  }

  /**
   * Opens the SDK's bidirectional streaming session (the overload that
   * takes no `audioChunk` - modelId only - which resolves a
   * `TranscribeStreamSession` rather than the deprecated upfront-audio
   * generator overload).
   */
  async transcribeStream(modelId: string): Promise<StreamTranscriptSession> {
    const session = await transcribeStream({ modelId });
    return wrapStreamSession(session);
  }
}
