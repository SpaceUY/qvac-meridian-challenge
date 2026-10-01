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
import { DEFAULT_SUPERTONIC_ENGINE_CONFIG } from '../../config/models.config.js';
import { TtsService } from './tts.service.js';

/** Resolves every load() immediately with a fresh modelId - no cancellation support needed for these tests. */
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

  async chatComplete(_modelId: string, _request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    throw new Error('not used by TtsService');
  }

  async embed(_modelId: string, _texts: string[]): Promise<number[][]> {
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

/** Lets already-queued microtasks (the service's internal .then/.catch chain) run before assertions. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function setup() {
  const runtime = new FakeModelRuntime();
  const models = new ModelManagementService(runtime, runtime);
  const port = new FakeTtsPort();
  const service = new TtsService(models, port);
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
});
