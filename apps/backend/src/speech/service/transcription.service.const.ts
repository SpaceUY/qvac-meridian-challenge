import { VAD_SILERO_5_1_2, WHISPER_TINY_Q8_0 } from '@qvac/sdk';
import type { ModelSource } from '../../models/domain/types.js';

/** The only whisper.cpp addon type this feature targets. */
export const WHISPER_MODEL_TYPE = 'whispercpp-transcription';

/** Small quantized multilingual whisper model - light enough for an 8GB RAM machine. */
export const DEFAULT_WHISPER_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: WHISPER_TINY_Q8_0.registryPath,
  registrySource: WHISPER_TINY_Q8_0.registrySource,
  modelType: WHISPER_MODEL_TYPE
};

/** `vadModelSrc` is required for `transcribeStream()` - the engine rejects streaming requests without it. */
export const DEFAULT_WHISPER_ENGINE_CONFIG = {
  detect_language: true,
  vadModelSrc: VAD_SILERO_5_1_2.src
};
