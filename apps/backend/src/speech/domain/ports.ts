import type { AudioInput, StreamTranscriptSession, TranscribeOptions, TranscriptionResult } from './types.js';

/** Model load/unload stays on `ModelManagementService`; this port only covers transcription. */
export interface SpeechTranscriptionPort {
  transcribe(modelId: string, audio: AudioInput, options?: TranscribeOptions): Promise<TranscriptionResult>;
  /** Async: the SDK's bidirectional-session overload opens a connection before `write()` is usable. */
  transcribeStream(modelId: string): Promise<StreamTranscriptSession>;
}
