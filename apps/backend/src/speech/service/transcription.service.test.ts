import { describe, expect, it, vi } from 'vitest';
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
import type { SpeechTranscriptionPort } from '../domain/ports.js';
import type { AudioInput, StreamTranscriptSession } from '../domain/types.js';
import { TranscriptionService } from './transcription.service.js';
import { DEFAULT_WHISPER_ENGINE_CONFIG, WHISPER_MODELS_BY_TIER } from '../../config/models.config.js';

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
    throw new Error('not used by TranscriptionService');
  }

  chatComplete(
    _modelId: string,
    _request: ChatCompletionRequest,
    _onToken?: (textDelta: string) => void
  ): Promise<ChatCompletionResult> & { requestId: string } {
    throw new Error('not used by TranscriptionService');
  }

  async unload(_modelId: string): Promise<void> {}

  async close(): Promise<void> {}

  async cancel(_requestId: string): Promise<void> {}
}

class FakeSpeechPort implements SpeechTranscriptionPort {
  transcribeCalls: { modelId: string; audio: AudioInput }[] = [];
  transcribeStreamCalls: string[] = [];

  async transcribe(modelId: string, audio: AudioInput): Promise<{ text: string }> {
    this.transcribeCalls.push({ modelId, audio });
    return { text: `transcript for ${modelId}` };
  }

  async transcribeStream(modelId: string): Promise<StreamTranscriptSession> {
    this.transcribeStreamCalls.push(modelId);
    return { write: vi.fn(), end: vi.fn(), destroy: vi.fn(), text: Promise.resolve(`live transcript for ${modelId}`) };
  }
}

describe('TranscriptionService', () => {
  it('loads the whisper model once, memoizing across multiple calls', async () => {
    const runtime = new FakeModelRuntime();
    const models = new ModelManagementService(runtime, runtime);
    const service = new TranscriptionService(models, new FakeSpeechPort());

    const first = await service.ensureModel();
    const second = await service.ensureModel();

    expect(first).toBe(second);
    expect(runtime.loadCalls).toHaveLength(1);
  });

  it('loads the whisper model with the default engine config (language auto-detect + VAD model)', async () => {
    const runtime = new FakeModelRuntime();
    const models = new ModelManagementService(runtime, runtime);
    const service = new TranscriptionService(models, new FakeSpeechPort());

    await service.ensureModel();

    expect(runtime.loadCalls[0]?.options).toEqual({ engineConfig: DEFAULT_WHISPER_ENGINE_CONFIG });
  });

  it('loads the tier-specific whisper model instead of always the default tier', async () => {
    const runtime = new FakeModelRuntime();
    const models = new ModelManagementService(runtime, runtime);
    const service = new TranscriptionService(models, new FakeSpeechPort(), 'high');

    await service.ensureModel();

    expect(runtime.loadCalls[0]?.source).toEqual(WHISPER_MODELS_BY_TIER.high);
  });

  it('transcribeFile loads the model and delegates a filePath AudioInput to the port', async () => {
    const runtime = new FakeModelRuntime();
    const models = new ModelManagementService(runtime, runtime);
    const port = new FakeSpeechPort();
    const service = new TranscriptionService(models, port);

    const text = await service.transcribeFile('/audio/sample-en.wav');

    expect(text).toBe(`transcript for ${port.transcribeCalls[0]?.modelId}`);
    expect(port.transcribeCalls[0]?.audio).toEqual({ kind: 'filePath', path: '/audio/sample-en.wav' });
  });

  it('transcribeBuffer loads the model and delegates a buffer AudioInput to the port', async () => {
    const runtime = new FakeModelRuntime();
    const models = new ModelManagementService(runtime, runtime);
    const port = new FakeSpeechPort();
    const service = new TranscriptionService(models, port);

    const data = Buffer.from([1, 2, 3]);
    const text = await service.transcribeBuffer(data);

    expect(text).toBe(`transcript for ${port.transcribeCalls[0]?.modelId}`);
    expect(port.transcribeCalls[0]?.audio).toEqual({ kind: 'buffer', data });
  });

  it('transcribeLive loads the model and opens a streaming session via the port', async () => {
    const runtime = new FakeModelRuntime();
    const models = new ModelManagementService(runtime, runtime);
    const port = new FakeSpeechPort();
    const service = new TranscriptionService(models, port);

    const session = await service.transcribeLive();

    expect(port.transcribeStreamCalls).toHaveLength(1);
    await expect(session.text).resolves.toBe(`live transcript for ${port.transcribeStreamCalls[0]}`);
  });
});
