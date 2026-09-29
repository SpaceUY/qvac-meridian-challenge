import { VAD_SILERO_5_1_2, WHISPER_TINY_Q8_0 } from '@qvac/sdk';
import type { ModelSource } from '../../models/domain/types.js';

/** The only whisper.cpp addon type this feature targets. */
export const WHISPER_MODEL_TYPE = 'whispercpp-transcription';

/**
 * Small quantized multilingual whisper model, already preloaded in
 * `qvac.config.json` - light enough for an 8GB RAM machine. Same catalog
 * constant `config/agentService.config.ts` uses for its own completion
 * model, applied here to the transcription engine.
 */
export const DEFAULT_WHISPER_MODEL_SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: WHISPER_TINY_Q8_0.registryPath,
  registrySource: WHISPER_TINY_Q8_0.registrySource,
  modelType: WHISPER_MODEL_TYPE
};

/**
 * `detect_language` enables EN/ES (and other) auto-detection. `vadModelSrc`
 * is required for `transcribeStream()`: the engine rejects streaming
 * requests without it ("VAD model name is required for Whisper
 * transcription") since it uses voice-activity detection to find segment
 * boundaries in a live audio stream - `transcribe()` doesn't need this,
 * since it processes a whole file at once.
 */
export const DEFAULT_WHISPER_ENGINE_CONFIG = {
  detect_language: true,
  vadModelSrc: VAD_SILERO_5_1_2.src
};
