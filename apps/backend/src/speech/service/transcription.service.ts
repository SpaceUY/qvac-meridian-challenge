import type { ModelManagementService } from '../../models/service/models.service.js';
import type { SpeechTranscriptionPort } from '../domain/ports.js';
import type { StreamTranscriptSession } from '../domain/types.js';
import { DEFAULT_WHISPER_ENGINE_CONFIG, WHISPER_MODELS_BY_TIER } from '../../config/models.config.js';
import { RESOURCE_TIER, type ResourceTier } from '../../config/resourceTier.js';

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

  /** `tier` defaults to the process-wide `RESOURCE_TIER`, overridable for tests. */
  constructor(
    private readonly models: ModelManagementService,
    private readonly port: SpeechTranscriptionPort,
    private readonly tier: ResourceTier = RESOURCE_TIER
  ) {}

  /** Loads the current tier's whisper model once (memoized), with language auto-detection on. */
  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.models
        .loadModel(WHISPER_MODELS_BY_TIER[this.tier], { engineConfig: DEFAULT_WHISPER_ENGINE_CONFIG })
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

  /** Prerecorded audio, in-memory flow: transcribes a buffer that's already fully available (e.g. from an HTTP upload), mirroring transcribeFile's filePath flow. */
  async transcribeBuffer(data: Buffer): Promise<string> {
    const modelId = await this.ensureModel();
    const result = await this.port.transcribe(modelId, { kind: 'buffer', data });
    return result.text;
  }

  /** The main hands-free flow: opens a live streaming session audio can be pushed into incrementally. */
  async transcribeLive(): Promise<StreamTranscriptSession> {
    const modelId = await this.ensureModel();
    return this.port.transcribeStream(modelId);
  }
}
