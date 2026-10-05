import { describe, expect, it } from 'vitest';
import { ModelManagementService } from '../../models/service/models.service.js';
import type { ModelProvisioningPort, ModelRuntimePort } from '../../models/domain/ports.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadModelOptions,
  ModelSource,
  RegistryModelSummary,
  RegistrySearchQuery
} from '../../models/domain/types.js';
import type { TextToSpeechPort } from '../domain/ports.js';
import type { SynthesisResult } from '../domain/types.js';
import { SynthesisInProgressError } from '../domain/errors.js';
import { DEFAULT_SUPERTONIC_ENGINE_CONFIG, TTS_MODELS_BY_TIER } from '../../config/models.config.js';
import { RESOURCE_TIER, type ResourceTier } from '../../config/resourceTier.js';
import { TtsService } from './tts.service.js';

/** Resolves every load() immediately with a fresh modelId. */
class FakeModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  loadCalls: { source: ModelSource; options?: LoadModelOptions }[] = [];
  private nextRequestId = 0;

  async searchRegistry(_query: RegistrySearchQuery): Promise<RegistryModelSummary[]> {
    return [];
  }

  async listRegistry(): Promise<RegistryModelSummary[]> {
    return [];
  }

  async provision(_source: ModelSource): Promise<void> {}

  load(source: ModelSource, options?: LoadModelOptions): Promise<LoadedModel> & { requestId: string } {
    this.loadCalls.push({ source, options });
    this.nextRequestId += 1;
    const requestId = `req-${this.nextRequestId}`;
    const result = Promise.resolve({ modelId: `model-${requestId}`, source, loadedAt: new Date() });
    return Object.assign(result, { requestId });
  }

  infer(_modelId: string, _prompt: string): Promise<InferenceResult> & { requestId: string } {
    throw new Error('not used by TtsService');
  }

  chatComplete(
    _modelId: string,
    _request: ChatCompletionRequest,
    _onToken?: (textDelta: string) => void
  ): Promise<ChatCompletionResult> & { requestId: string } {
    throw new Error('not used by TtsService');
  }

  async unload(_modelId: string): Promise<void> {}

  async close(): Promise<void> {}

  async cancel(_requestId: string): Promise<void> {}
}

/** Controllable fake: synthesize() only settles when the test calls resolveNext()/rejectNext(). */
class FakeTtsPort implements TextToSpeechPort {
  synthesizeCalls: { modelId: string; text: string }[] = [];
  cancelCalls: string[] = [];
  private pendingResolve?: (result: SynthesisResult) => void;
  private pendingReject?: (err: unknown) => void;

  synthesize(modelId: string, text: string): Promise<SynthesisResult> {
    this.synthesizeCalls.push({ modelId, text });
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  async cancel(modelId: string): Promise<void> {
    this.cancelCalls.push(modelId);
  }

  resolveNext(result: SynthesisResult): void {
    this.pendingResolve?.(result);
  }

  rejectNext(err: unknown): void {
    this.pendingReject?.(err);
  }
}

/** Lets queued microtasks (the service's .then/.catch chain) run before assertions. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup(tier: ResourceTier = RESOURCE_TIER) {
  const runtime = new FakeModelRuntime();
  const models = new ModelManagementService(runtime, runtime);
  const port = new FakeTtsPort();
  const service = new TtsService(models, port, tier);
  return { runtime, port, service };
}

describe('TtsService', () => {
  it('is idle before any synthesis is requested', () => {
    const { service } = setup();

    expect(service.getStatus()).toBe('idle');
    expect(service.getAudio()).toBeUndefined();
  });

  it('loads the Supertonic model with the default engine config, memoized across calls', async () => {
    const { runtime, port, service } = setup();

    await service.synthesize('hello');
    port.resolveNext({ audio: Buffer.from([1]), sampleRate: 44100 });
    await flushMicrotasks();

    await service.synthesize('hello again');

    expect(runtime.loadCalls).toHaveLength(1);
    expect(runtime.loadCalls[0]?.options).toEqual({ engineConfig: DEFAULT_SUPERTONIC_ENGINE_CONFIG });
  });

  it('loads the tier-specific Supertonic model instead of always the default tier', async () => {
    const { runtime, port, service } = setup('high');

    await service.synthesize('hello');
    port.resolveNext({ audio: Buffer.from([1]), sampleRate: 44100 });
    await flushMicrotasks();

    expect(runtime.loadCalls[0]?.source).toEqual(TTS_MODELS_BY_TIER.high);
  });

  it('goes pending -> succeeded and exposes the resulting audio', async () => {
    const { service, port } = setup();

    await service.synthesize('hello');
    expect(service.getStatus()).toBe('pending');
    expect(service.getAudio()).toBeUndefined();

    const audio = Buffer.from([1, 2, 3]);
    port.resolveNext({ audio, sampleRate: 44100 });
    await flushMicrotasks();

    expect(service.getStatus()).toBe('succeeded');
    expect(service.getAudio()).toBe(audio);
  });

  it('goes pending -> failed when the port rejects, and clears the audio slot', async () => {
    const { service, port } = setup();

    await service.synthesize('hello');
    port.rejectNext(new Error('boom'));
    await flushMicrotasks();

    expect(service.getStatus()).toBe('failed');
    expect(service.getAudio()).toBeUndefined();
  });

  it('rejects a new synthesize() call while one is already pending', async () => {
    const { service, port } = setup();

    await service.synthesize('first');

    await expect(service.synthesize('second')).rejects.toBeInstanceOf(SynthesisInProgressError);
    expect(port.synthesizeCalls).toHaveLength(1);
  });

  it('cancel() calls the port with the loaded modelId and moves the slot to cancelled', async () => {
    const { service, port } = setup();

    await service.synthesize('hello');
    const loadedModelId = port.synthesizeCalls[0]?.modelId;
    await service.cancel();

    expect(port.cancelCalls).toEqual([loadedModelId]);
    expect(service.getStatus()).toBe('cancelled');
  });

  it('a late resolve from an already-cancelled synthesis does not clobber the cancelled state', async () => {
    const { service, port } = setup();

    await service.synthesize('hello');
    await service.cancel();

    port.resolveNext({ audio: Buffer.from([9]), sampleRate: 44100 });
    await flushMicrotasks();

    expect(service.getStatus()).toBe('cancelled');
    expect(service.getAudio()).toBeUndefined();
  });

  it('cancel() is a no-op when nothing is pending', async () => {
    const { service, port } = setup();

    await service.cancel();

    expect(port.cancelCalls).toEqual([]);
    expect(service.getStatus()).toBe('idle');
  });

  it('synthesizeSync loads the model and resolves directly with the port result, without touching the slot', async () => {
    const { service, port } = setup();

    const promise = service.synthesizeSync('hello');
    await flushMicrotasks();
    const audio = Buffer.from([4, 5, 6]);
    port.resolveNext({ audio, sampleRate: 44100 });

    await expect(promise).resolves.toEqual({ audio, sampleRate: 44100 });
    expect(service.getStatus()).toBe('idle');
    expect(service.getAudio()).toBeUndefined();
  });

  it('synthesizeSync rejects while an async synthesize() is already pending', async () => {
    const { service, port } = setup();

    await service.synthesize('first');

    await expect(service.synthesizeSync('second')).rejects.toBeInstanceOf(SynthesisInProgressError);
    expect(port.synthesizeCalls).toHaveLength(1);
  });

  it('synthesizeSync propagates a port rejection without changing the slot', async () => {
    const { service, port } = setup();

    const promise = service.synthesizeSync('hello');
    await flushMicrotasks();
    port.rejectNext(new Error('boom'));

    await expect(promise).rejects.toThrow('boom');
    expect(service.getStatus()).toBe('idle');
  });
});
