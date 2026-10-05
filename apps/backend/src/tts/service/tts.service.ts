import { toModelManagementError } from '../../models/domain/errors.js';
import type { ModelManagementService } from '../../models/service/models.service.js';
import type { TextToSpeechPort } from '../domain/ports.js';
import { SynthesisInProgressError } from '../domain/errors.js';
import type { SynthesisResult, SynthesisState } from '../domain/types.js';
import { DEFAULT_SUPERTONIC_ENGINE_CONFIG, TTS_MODELS_BY_TIER } from '../../config/models.config.js';
import { RESOURCE_TIER, type ResourceTier } from '../../config/resourceTier.js';

interface SynthesisSlot {
  state: SynthesisState;
  audio?: Buffer;
}

/** One global synthesis slot per process, not per session - textToSpeech() has no per-call requestId to key a queue on. */
export class TtsService {
  private modelIdPromise?: Promise<string>;
  private slot: SynthesisSlot = { state: 'idle' };

  /** `tier` defaults to the process-wide `RESOURCE_TIER`, overridable for tests. */
  constructor(
    private readonly models: ModelManagementService,
    private readonly port: TextToSpeechPort,
    private readonly tier: ResourceTier = RESOURCE_TIER
  ) {}

  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.models
        .loadModel(TTS_MODELS_BY_TIER[this.tier], { engineConfig: DEFAULT_SUPERTONIC_ENGINE_CONFIG })
        .then((loaded) => loaded.modelId)
        .catch((error: unknown) => {
          this.modelIdPromise = undefined;
          throw error;
        });
    }
    return this.modelIdPromise;
  }

  /** Awaits the model load only; the synthesis itself runs in the background. */
  async synthesize(text: string): Promise<void> {
    if (this.slot.state === 'pending') {
      throw new SynthesisInProgressError();
    }
    const modelId = await this.ensureModel();
    this.slot = { state: 'pending' };
    this.runInBackground(modelId, text);
  }

  /** For callers needing the audio in the same call (VoiceAgentService). Still throws if an async synthesis is mid-flight, to avoid calling the port concurrently. */
  async synthesizeSync(text: string): Promise<SynthesisResult> {
    if (this.slot.state === 'pending') {
      throw new SynthesisInProgressError();
    }
    const modelId = await this.ensureModel();
    return this.port.synthesize(modelId, text);
  }

  private runInBackground(modelId: string, text: string): void {
    this.port
      .synthesize(modelId, text)
      .then((result) => {
        if (this.slot.state === 'pending') this.slot = { state: 'succeeded', audio: result.audio };
      })
      .catch((err: unknown) => {
        if (this.slot.state === 'pending') this.slot = { state: 'failed' };
        console.error('[tts:inference]', toModelManagementError('inference', err).cause ?? err);
      });
  }

  async cancel(): Promise<void> {
    if (this.slot.state !== 'pending') return;
    const modelId = await this.ensureModel();
    try {
      await this.port.cancel(modelId);
    } catch (err) {
      throw toModelManagementError('cancel', err);
    }
    this.slot = { state: 'cancelled' };
  }

  getStatus(): SynthesisState {
    return this.slot.state;
  }

  getAudio(): Buffer | undefined {
    return this.slot.state === 'succeeded' ? this.slot.audio : undefined;
  }
}
