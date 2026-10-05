import type { SynthesisOptions, SynthesisResult } from './types.js';

export interface TextToSpeechPort {
  synthesize(modelId: string, text: string, options?: SynthesisOptions): Promise<SynthesisResult>;
  /** Broad-cancel by modelId - textToSpeech() has no per-call requestId like loadModel()/completion() do. */
  cancel(modelId: string): Promise<void>;
}
