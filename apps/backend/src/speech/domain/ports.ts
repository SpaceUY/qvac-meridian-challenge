import type { AudioInput, StreamTranscriptSession, TranscribeOptions, TranscriptionResult } from './types.js';

/**
 * The only new port this feature needs: transcription itself.
 * `QvacTranscriptionAdapter` is the only implementation today. Model
 * loading/unloading for the transcription model is handled by the
 * existing `ModelManagementService`, not by this port - see
 * `service/transcription.service.ts`.
 */
export interface SpeechTranscriptionPort {
  /** Transcribes prerecorded audio in one call (optional flow, for a file/buffer that's already fully available). */
  transcribe(modelId: string, audio: AudioInput, options?: TranscribeOptions): Promise<TranscriptionResult>;
  /** Opens a live streaming session - the main hands-free flow. Async: the SDK's bidirectional-session overload opens a connection before `write()` is usable. */
  transcribeStream(modelId: string): Promise<StreamTranscriptSession>;
}
