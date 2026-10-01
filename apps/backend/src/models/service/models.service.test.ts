import { beforeEach, describe, expect, it } from 'vitest';
import { ModelManagementError, OperationCancelledError } from '../domain/errors.js';
import type { ModelProvisioningPort, ModelRuntimePort } from '../domain/ports.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  InferenceResult,
  LoadedModel,
  LoadModelOptions,
  ModelDownloadProgress,
  ModelSource,
  RegistryModelSummary,
  RegistrySearchQuery
} from '../domain/types.js';
import { ModelManagementService } from './models.service.js';

interface PendingCall {
  resolve: () => void;
  reject: (err: unknown) => void;
}

/**
 * Stands in for `QvacRuntimeAdapter` without touching `@qvac/sdk`. Mirrors
 * the real SDK's requestId-keyed cancel registry (see
 * `infra/qvacRuntimeAdapter.ts` and `cancelHandler.js` in the installed
 * SDK): every `load()`/`infer()` call is held open on a requestId until the
 * test explicitly settles or cancels it, and `cancel()` on an unknown or
 * already-settled requestId is a safe no-op - it never throws. Rejects with
 * `OperationCancelledError` on cancel, exactly like `QvacRuntimeAdapter`
 * does when it catches the SDK's `InferenceCancelledError`, so
 * `ModelManagementService.getRequestStatus()` can tell "cancelled" apart
 * from "failed" in tests the same way it does against the real adapter.
 */
class FakeModelRuntime implements ModelProvisioningPort, ModelRuntimePort {
  private nextRequestId = 0;
  private readonly pending = new Map<string, PendingCall>();

  async searchRegistry(_query: RegistrySearchQuery): Promise<RegistryModelSummary[]> {
    return [];
  }

  async listRegistry(): Promise<RegistryModelSummary[]> {
    return [];
  }

  async provision(_source: ModelSource): Promise<void> {}

  load(
    source: ModelSource,
    _options?: LoadModelOptions,
    _onProgress?: (progress: ModelDownloadProgress) => void
  ): Promise<LoadedModel> & { requestId: string } {
    const requestId = this.newRequestId();
    return this.track(requestId, () => ({ modelId: `model-${requestId}`, source, loadedAt: new Date() }));
  }

  infer(modelId: string, prompt: string): Promise<InferenceResult> & { requestId: string } {
    const requestId = this.newRequestId();
    return this.track(requestId, () => ({ text: `reply to "${prompt}" from ${modelId}` }));
  }

  async chatComplete(_modelId: string, _request: ChatCompletionRequest): Promise<ChatCompletionResult> {
    return { text: '', toolCalls: [] };
  }

  /** One-hot vectors: input i gets a 1 in position i. Deterministic and trivially assertable. */
  async embed(_modelId: string, texts: string[]): Promise<number[][]> {
    return texts.map((_text, index) =>
      Array.from({ length: 3 }, (_zero, position) => (position === index ? 1 : 0))
    );
  }

  async unload(_modelId: string): Promise<void> {}

  async close(): Promise<void> {}

  async cancel(requestId: string): Promise<void> {
    const call = this.pending.get(requestId);
    if (!call) return; // unknown, already-settled, or already-cancelled: safe no-op, matches the real SDK
    this.pending.delete(requestId);
    call.reject(new OperationCancelledError(requestId));
  }

  /** Test hook: resolves the given in-flight call with its normal result. Throws if `requestId` isn't pending. */
  settle(requestId: string): void {
    const call = this.pending.get(requestId);
    if (!call) throw new Error(`no pending call for requestId "${requestId}"`);
    this.pending.delete(requestId);
    call.resolve();
  }

  private newRequestId(): string {
    this.nextRequestId += 1;
    return `req-${this.nextRequestId}`;
  }

  private track<T>(requestId: string, makeValue: () => T): Promise<T> & { requestId: string } {
    let resolvePromise!: (value: T) => void;
    let rejectPromise!: (err: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    this.pending.set(requestId, {
      resolve: () => resolvePromise(makeValue()),
      reject: (err: unknown) => rejectPromise(err)
    });
    return Object.assign(promise, { requestId });
  }
}

/** A runtime whose `cancel()` always fails, to exercise `ModelManagementService.cancel()`'s own error wrapping. */
class FailingCancelRuntime extends FakeModelRuntime {
  override async cancel(_requestId: string): Promise<void> {
    throw new Error('boom');
  }
}

const SOURCE: ModelSource = { kind: 'url', url: 'https://example.com/model.gguf' };

describe('ModelManagementService cancellation', () => {
  let runtime: FakeModelRuntime;
  let service: ModelManagementService;

  beforeEach(() => {
    runtime = new FakeModelRuntime();
    service = new ModelManagementService(runtime, runtime);
  });

  it('cancels an in-flight load: the load rejects and the model never becomes loaded', async () => {
    const pending = service.loadModel(SOURCE);
    expect(service.getRequestStatus(pending.requestId)).toMatchObject({ kind: 'load', state: 'pending' });

    await service.cancel(pending.requestId);

    await expect(pending).rejects.toBeInstanceOf(ModelManagementError);
    expect(service.isLoaded(`model-${pending.requestId}`)).toBe(false);
    expect(service.getRequestStatus(pending.requestId)).toMatchObject({ kind: 'load', state: 'cancelled' });
  });

  it('a cancelled load can be retried and succeeds', async () => {
    const first = service.loadModel(SOURCE);
    await service.cancel(first.requestId);
    await expect(first).rejects.toBeInstanceOf(ModelManagementError);

    const second = service.loadModel(SOURCE);
    runtime.settle(second.requestId);
    const loaded = await second;

    expect(service.isLoaded(loaded.modelId)).toBe(true);
  });

  it('cancels an in-flight inference without unloading the model or breaking future inference', async () => {
    const load = service.loadModel(SOURCE);
    runtime.settle(load.requestId);
    const loaded = await load;
    expect(service.getRequestStatus(load.requestId)).toMatchObject({ kind: 'load', state: 'succeeded', modelId: loaded.modelId });

    const inference = service.infer(loaded.modelId, 'first prompt');
    await service.cancel(inference.requestId);
    await expect(inference).rejects.toBeInstanceOf(ModelManagementError);
    expect(service.isLoaded(loaded.modelId)).toBe(true);
    expect(service.getRequestStatus(inference.requestId)).toMatchObject({
      kind: 'inference',
      state: 'cancelled',
      modelId: loaded.modelId
    });

    const followUp = service.infer(loaded.modelId, 'second prompt');
    runtime.settle(followUp.requestId);
    await expect(followUp).resolves.toEqual({ text: `reply to "second prompt" from ${loaded.modelId}` });
    expect(service.getRequestStatus(followUp.requestId)).toMatchObject({
      kind: 'inference',
      state: 'succeeded',
      text: `reply to "second prompt" from ${loaded.modelId}`
    });
  });

  it('getRequestStatus returns undefined for a requestId that was never issued', () => {
    expect(service.getRequestStatus('never-issued')).toBeUndefined();
  });

  it('cancelling an unknown requestId is a safe no-op', async () => {
    await expect(service.cancel('does-not-exist')).resolves.toBeUndefined();
  });

  it('cancelling an already-completed requestId is a safe no-op', async () => {
    const load = service.loadModel(SOURCE);
    runtime.settle(load.requestId);
    await load;

    await expect(service.cancel(load.requestId)).resolves.toBeUndefined();
  });

  it('double-cancelling the same in-flight requestId is safe', async () => {
    const load = service.loadModel(SOURCE);

    await service.cancel(load.requestId);
    await expect(load).rejects.toBeInstanceOf(ModelManagementError);
    await expect(service.cancel(load.requestId)).resolves.toBeUndefined();
  });

  it('wraps a genuine cancel failure into a ModelManagementError tagged "cancel"', async () => {
    const failingRuntime = new FailingCancelRuntime();
    const failingService = new ModelManagementService(failingRuntime, failingRuntime);

    await expect(failingService.cancel('any-id')).rejects.toMatchObject({
      stage: 'cancel'
    });
  });

  it('embeds texts with a loaded model, one vector per input', async () => {
    const load = service.loadModel(SOURCE);
    runtime.settle(load.requestId);
    const { modelId } = await load;

    const vectors = await service.embed(modelId, ['hola', 'chau']);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toEqual([1, 0, 0]);
    expect(vectors[1]).toEqual([0, 1, 0]);
  });

  it('refuses to embed with a model that is not loaded', async () => {
    await expect(service.embed('never-loaded', ['hola'])).rejects.toBeInstanceOf(ModelManagementError);
  });
});
