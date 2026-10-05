/** SDK-agnostic domain types - only infra/qvacTtsAdapter.ts may import @qvac/sdk. */

export interface SynthesisResult {
  audio: Buffer;
  sampleRate: number;
}

export type SynthesisState = 'idle' | 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface SynthesisOptions {
  /**
   * Stops the synthesis once aborted: no further engine job starts and the
   * call rejects with the signal's reason. A job already in the engine
   * still finishes - the SDK can't interrupt a TTS job (see QvacTtsAdapter).
   */
  signal?: AbortSignal;
}
