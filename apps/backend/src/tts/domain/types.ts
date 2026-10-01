/** SDK-agnostic domain types - only infra/qvacTtsAdapter.ts may import @qvac/sdk. */

export interface SynthesisResult {
  audio: Buffer;
  sampleRate: number;
}

export type SynthesisState = 'idle' | 'pending' | 'succeeded' | 'failed' | 'cancelled';
