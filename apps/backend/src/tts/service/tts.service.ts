import { toModelManagementError } from '../../models/domain/errors.js';
import type { ModelManagementService } from '../../models/service/models.service.js';
import type { TextToSpeechPort } from '../domain/ports.js';
import { SynthesisInProgressError } from '../domain/errors.js';
import type { SynthesisResult, SynthesisState } from '../domain/types.js';
import { DEFAULT_SUPERTONIC_ENGINE_CONFIG, SUPERTONIC2_TTS_MODEL_SOURCE } from '../../config/models.config.js';

interface SynthesisSlot {
  state: SynthesisState;
  audio?: Buffer;
}

/**
 * Reuses ModelManagementService for the Supertonic load lifecycle. Keeps
 * one global synthesis slot per process, not per session - textToSpeech()
 * has no per-call requestId to key a queue on. Concurrent callers share
 * this slot: a second synthesize() while one is pending throws
 * SynthesisInProgressError, and getAudio() returns the last completed
 * synthesis, not "yours".
 */
export class TtsService {
  private modelIdPromise?: Promise<string>;
  private slot: SynthesisSlot = { state: 'idle' };

  constructor(
    private readonly models: ModelManagementService,
    private readonly port: TextToSpeechPort
  ) {}

  async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.models
        .loadModel(SUPERTONIC2_TTS_MODEL_SOURCE, { engineConfig: DEFAULT_SUPERTONIC_ENGINE_CONFIG })
        .then((loaded) => loaded.modelId)
        .catch((error: unknown) => {
          this.modelIdPromise = undefined;
          throw error;
        });
    }
    return this.modelIdPromise;
  }

  /** Awaits the model load (failures surface here); the synthesis itself runs in the background. */
  async synthesize(text: string): Promise<void> {
    if (this.slot.state === 'pending') {
      throw new SynthesisInProgressError();
    }
    const modelId = await this.ensureModel();
    this.slot = { state: 'pending' };
    this.runInBackground(modelId, text);
  }

  /** Synchronous flow for callers that need the finished audio in the same call (VoiceAgentService) — bypasses the pending/cancel slot the async synthesize()/getAudio() flow uses. Still respects that slot: throws if an async synthesis is mid-flight, instead of calling the port concurrently against the one loaded Supertonic model. */
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
