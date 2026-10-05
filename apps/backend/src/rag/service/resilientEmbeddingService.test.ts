import { describe, expect, it, vi } from 'vitest';
import type { ModelManagementService } from '../../models/service/models.service.js';
import type { ModelSource } from '../../models/domain/types.js';
import type { QvacEmbeddingAdapter } from '../infra/qvacEmbeddingAdapter.js';
import { QvacEmbeddingService } from './qvacEmbeddingService.js';
import { ResilientEmbeddingService, type NativeEmbeddingLike } from './resilientEmbeddingService.js';

const MODEL_SOURCE: ModelSource = { kind: 'url', url: 'https://example.com/embeddinggemma.gguf' };

function fakeModels(loadModel: (source: ModelSource) => Promise<{ modelId: string }>) {
  return { loadModel } as unknown as ModelManagementService;
}

/** A `QvacEmbeddingService` wired to a controllable fake adapter - the real class, so fallback behavior is tested against the actual implementation, not a hand-rolled stand-in. */
function sdkFallback(embedOne: (modelId: string, text: string) => Promise<number[]>): QvacEmbeddingService {
  const loadModel = vi.fn().mockResolvedValue({ modelId: 'sdk-model-1' });
  const adapter = { embedOne, embedMany: vi.fn() } as unknown as QvacEmbeddingAdapter;
  return new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);
}

/** Uses `Object.defineProperties`, not a spread, so a getter in `overrides` (e.g. live `isCrashed`) stays a live getter instead of being evaluated once and frozen. */
function fakeNative(overrides: Partial<NativeEmbeddingLike> = {}): NativeEmbeddingLike {
  const base: NativeEmbeddingLike = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    embed: vi.fn().mockResolvedValue([0.1, 0.2]),
    embedBatch: vi.fn().mockResolvedValue([[0.1, 0.2]]),
    unload: vi.fn().mockResolvedValue(undefined),
    isCrashed: false
  };
  return Object.defineProperties(base, Object.getOwnPropertyDescriptors(overrides)) as NativeEmbeddingLike;
}

function service(native: NativeEmbeddingLike, createSdkFallback: () => QvacEmbeddingService): ResilientEmbeddingService {
  // Dummy values: unread when native/sdkFallback are both injected (see constructor).
  return new ResilientEmbeddingService(
    fakeModels(vi.fn()),
    {} as QvacEmbeddingAdapter,
    MODEL_SOURCE,
    16,
    0,
    native,
    createSdkFallback
  );
}

describe('ResilientEmbeddingService - provider selection', () => {
  it('uses the native provider when it loads successfully, and never touches the SDK factory', async () => {
    const native = fakeNative();
    const createSdkFallback = vi.fn();
    const svc = service(native, createSdkFallback);

    const vector = await svc.embed('hello');

    expect(vector).toEqual([0.1, 0.2]);
    expect(native.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(createSdkFallback).not.toHaveBeenCalled();
  });

  it('selects the provider once and reuses the decision across many calls', async () => {
    const native = fakeNative();
    const svc = service(native, () => sdkFallback(vi.fn()));

    await svc.embed('a');
    await svc.embed('b');
    await svc.embedBatch(['c', 'd']);

    expect(native.ensureLoaded).toHaveBeenCalledTimes(1);
  });

  it('falls back to the SDK when native initialization fails', async () => {
    const native = fakeNative({ ensureLoaded: vi.fn().mockRejectedValue(new Error('bare.exe not found')) });
    const embedOne = vi.fn().mockResolvedValue([0.9, 0.8]);
    const createSdkFallback = vi.fn(() => sdkFallback(embedOne));
    const svc = service(native, createSdkFallback);

    const vector = await svc.embed('hello');

    expect(vector).toEqual([0.9, 0.8]);
    expect(createSdkFallback).toHaveBeenCalledTimes(1);
    expect(embedOne).toHaveBeenCalledWith('sdk-model-1', 'hello');
  });

  it('does not retry native initialization on later calls once it has failed once', async () => {
    const native = fakeNative({ ensureLoaded: vi.fn().mockRejectedValue(new Error('bare.exe not found')) });
    const svc = service(native, () => sdkFallback(vi.fn().mockResolvedValue([0.1])));

    await svc.embed('a');
    await svc.embed('b');

    expect(native.ensureLoaded).toHaveBeenCalledTimes(1);
  });
});

describe('ResilientEmbeddingService - crash failover', () => {
  it('fails over to the SDK, retries the failed call, and succeeds when the native worker crashes mid-session', async () => {
    let crashed = false;
    const native = fakeNative({
      embed: vi.fn().mockImplementation(() => {
        crashed = true;
        return Promise.reject(new Error('native embed worker exited unexpectedly (code=null, signal=SIGSEGV)'));
      }),
      get isCrashed() {
        return crashed;
      }
    });
    const embedOne = vi.fn().mockResolvedValue([0.5, 0.5]);
    const svc = service(native, () => sdkFallback(embedOne));

    const vector = await svc.embed('still works');

    expect(vector).toEqual([0.5, 0.5]);
    expect(embedOne).toHaveBeenCalledWith('sdk-model-1', 'still works');
  });

  it('uses the SDK directly for every call after a crash, without touching native again', async () => {
    let crashed = false;
    const native = fakeNative({
      embed: vi.fn().mockImplementation(() => {
        if (!crashed) {
          crashed = true;
          return Promise.reject(new Error('worker exited unexpectedly'));
        }
        return Promise.reject(new Error('should never be called again'));
      }),
      get isCrashed() {
        return crashed;
      }
    });
    const embedOne = vi.fn().mockResolvedValue([0.1]);
    const svc = service(native, () => sdkFallback(embedOne));

    await svc.embed('first (crashes, fails over)');
    await svc.embed('second (should go straight to sdk)');

    expect(embedOne).toHaveBeenCalledTimes(2);
    expect(native.embed).toHaveBeenCalledTimes(1);
  });

  it('does not fail over for a non-crash error - the error propagates and the SDK is never touched', async () => {
    const native = fakeNative({
      embed: vi.fn().mockRejectedValue(new Error('malformed embedding vector: empty vector')),
      isCrashed: false
    });
    const createSdkFallback = vi.fn();
    const svc = service(native, createSdkFallback);

    await expect(svc.embed('bad input')).rejects.toThrow(/malformed embedding vector/i);
    expect(createSdkFallback).not.toHaveBeenCalled();
  });

  it('applies the same crash failover to embedBatch()', async () => {
    let crashed = false;
    const native = fakeNative({
      embedBatch: vi.fn().mockImplementation(() => {
        crashed = true;
        return Promise.reject(new Error('worker exited unexpectedly'));
      }),
      get isCrashed() {
        return crashed;
      }
    });
    const embedMany = vi.fn().mockResolvedValue([[0.1], [0.2]]);
    const adapter = { embedOne: vi.fn(), embedMany } as unknown as QvacEmbeddingAdapter;
    const models = fakeModels(vi.fn().mockResolvedValue({ modelId: 'sdk-1' }));
    const fallback = new QvacEmbeddingService(models, adapter, MODEL_SOURCE, 16);
    const svc = service(native, () => fallback);

    const vectors = await svc.embedBatch(['a', 'b']);

    expect(vectors).toEqual([[0.1], [0.2]]);
    expect(embedMany).toHaveBeenCalledWith('sdk-1', ['a', 'b']);
  });
});

describe('ResilientEmbeddingService.unload', () => {
  it('unloads the native provider even when the SDK fallback was never constructed', async () => {
    const native = fakeNative();
    const createSdkFallback = vi.fn();
    const svc = service(native, createSdkFallback);

    await svc.unload();

    expect(native.unload).toHaveBeenCalledTimes(1);
    expect(createSdkFallback).not.toHaveBeenCalled();
  });

  it('unloads both providers once a mid-session fallback has happened', async () => {
    let crashed = false;
    const native = fakeNative({
      embed: vi.fn().mockImplementation(() => {
        crashed = true;
        return Promise.reject(new Error('worker exited unexpectedly'));
      }),
      get isCrashed() {
        return crashed;
      }
    });
    const unloadModel = vi.fn(async () => {});
    const models = { loadModel: vi.fn().mockResolvedValue({ modelId: 'sdk-1' }), unloadModel } as unknown as ModelManagementService;
    const adapter = { embedOne: vi.fn().mockResolvedValue([0.1]), embedMany: vi.fn() } as unknown as QvacEmbeddingAdapter;
    const fallback = new QvacEmbeddingService(models, adapter, MODEL_SOURCE, 16);
    const svc = service(native, () => fallback);

    await svc.embed('trigger fallback');
    await svc.unload();

    expect(native.unload).toHaveBeenCalledTimes(1);
    expect(unloadModel).toHaveBeenCalledWith('sdk-1');
  });
});
