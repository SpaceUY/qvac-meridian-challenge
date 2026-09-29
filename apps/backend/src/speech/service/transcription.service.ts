import type { ModelManagementService } from '../../models/service/models.service.js';
import type { SpeechTranscriptionPort } from '../domain/ports.js';
import type { StreamTranscriptSession } from '../domain/types.js';
import { DEFAULT_WHISPER_ENGINE_CONFIG, DEFAULT_WHISPER_MODEL_SOURCE } from './transcription.service.const.js';

/**
 * Orchestrates local speech-to-text: reuses the existing
 * `ModelManagementService` for the whisper model's load/unload lifecycle
 * (the same lifecycle every other local model in this app goes through),
 * and delegates the actual transcription calls to `SpeechTranscriptionPort`.
 * Mirrors the two-dependency shape `AgentService` uses for
 * `ModelManagementService` + `ChatQVAC`.
 */
export class TranscriptionService {
  private modelIdPromise?: Promise<string>;

  constructor(
    private readonly models: ModelManagementService,
    private readonly port: SpeechTranscriptionPort
  ) {}

  /**
   * Loads whisper-tiny-q8-0 once (memoized), with language auto-detection
   * enabled so English and Spanish (and anything else whisper-tiny
   * supports) are both handled without a fixed `language`.
   */
  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.models
        .loadModel(DEFAULT_WHISPER_MODEL_SOURCE, { engineConfig: DEFAULT_WHISPER_ENGINE_CONFIG })
        .then((loaded) => loaded.modelId)
        .catch((error: unknown) => {
          this.modelIdPromise = undefined;
          throw error;
        });
    }
    return this.modelIdPromise;
  }

  /** Prerecorded audio, optional flow: transcribes a whole file in one call. */
  async transcribeFile(path: string): Promise<string> {
    const modelId = await this.ensureModel();
    const result = await this.port.transcribe(modelId, { kind: 'filePath', path });
    return result.text;
  }

  /** The main hands-free flow: opens a live streaming session audio can be pushed into incrementally. */
  async transcribeLive(): Promise<StreamTranscriptSession> {
    const modelId = await this.ensureModel();
    return this.port.transcribeStream(modelId);
  }
}
