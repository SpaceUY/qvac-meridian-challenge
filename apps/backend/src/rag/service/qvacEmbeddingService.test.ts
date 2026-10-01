import { describe, expect, it, vi } from 'vitest';
import type { ModelManagementService } from '../../models/service/models.service.js';
import type { ModelSource } from '../../models/domain/types.js';
import type { QvacEmbeddingAdapter } from '../infra/qvacEmbeddingAdapter.js';
import { QvacEmbeddingService } from './qvacEmbeddingService.js';

const MODEL_SOURCE: ModelSource = { kind: 'url', url: 'https://example.com/nomic.gguf' };

function fakeModels(loadModel: (source: ModelSource) => Promise<{ modelId: string }>) {
  return { loadModel } as unknown as ModelManagementService;
}

describe('QvacEmbeddingService', () => {
  it('loads the model once and reuses it across embed() and embedBatch() calls', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    const embedOne = vi.fn().mockResolvedValue([0.1, 0.2]);
    const embedMany = vi.fn().mockResolvedValue([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    const adapter = { embedOne, embedMany } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);

    await service.embed('query text');
    await service.embedBatch(['chunk a', 'chunk b']);

    expect(loadModel).toHaveBeenCalledTimes(1);
    expect(embedOne).toHaveBeenCalledWith('nomic-1', 'query text');
    expect(embedMany).toHaveBeenCalledWith('nomic-1', ['chunk a', 'chunk b']);
  });

  it('splits embedBatch() into batchSize-sized chunks, in order', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    const embedMany = vi.fn().mockImplementation((_modelId: string, texts: string[]) =>
      Promise.resolve(texts.map((t) => [t.length])),
    );
    const adapter = { embedOne: vi.fn(), embedMany } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 2);

    const vectors = await service.embedBatch(['a', 'bb', 'ccc', 'dddd', 'e']);

    expect(embedMany).toHaveBeenCalledTimes(3);
    expect(embedMany).toHaveBeenNthCalledWith(1, 'nomic-1', ['a', 'bb']);
    expect(embedMany).toHaveBeenNthCalledWith(2, 'nomic-1', ['ccc', 'dddd']);
    expect(embedMany).toHaveBeenNthCalledWith(3, 'nomic-1', ['e']);
    expect(vectors).toEqual([[1], [2], [3], [4], [1]]);
  });

  it('returns an empty array for an empty embedBatch() input without loading the model', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    const adapter = { embedOne: vi.fn(), embedMany: vi.fn() } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);

    const vectors = await service.embedBatch([]);

    expect(vectors).toEqual([]);
    expect(loadModel).not.toHaveBeenCalled();
  });

  it('fixes the expected dimension on the first vector and rejects a later mismatch', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    const embedOne = vi
      .fn()
      .mockResolvedValueOnce([0.1, 0.2, 0.3])
      .mockResolvedValueOnce([0.1, 0.2]);
    const adapter = { embedOne, embedMany: vi.fn() } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);

    await expect(service.embed('first')).resolves.toHaveLength(3);
    await expect(service.embed('second')).rejects.toThrow(/dimension mismatch/i);
  });

  it('rejects an empty vector', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    const embedOne = vi.fn().mockResolvedValue([]);
    const adapter = { embedOne, embedMany: vi.fn() } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);

    await expect(service.embed('text')).rejects.toThrow(/malformed/i);
  });

  it('rejects a vector containing a non-finite value', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    const embedOne = vi.fn().mockResolvedValue([0.1, Number.NaN, 0.3]);
    const adapter = { embedOne, embedMany: vi.fn() } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);

    await expect(service.embed('text')).rejects.toThrow(/malformed/i);
  });

  it('serializes concurrent embed() calls so only one adapter call is ever in flight', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    let inFlight = 0;
    let maxInFlight = 0;
    const embedOne = vi.fn().mockImplementation(async (_modelId: string, text: string) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return [text.length];
    });
    const adapter = { embedOne, embedMany: vi.fn() } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);

    await Promise.all(['a', 'bb', 'ccc'].map((text) => service.embed(text)));

    expect(maxInFlight).toBe(1);
    expect(embedOne).toHaveBeenCalledTimes(3);
  });

  it('never calls any external embedding service - only the injected adapter', async () => {
    const loadModel = vi.fn().mockResolvedValue({ modelId: 'nomic-1' });
    const embedOne = vi.fn().mockResolvedValue([0.1]);
    const embedMany = vi.fn().mockResolvedValue([[0.1]]);
    const adapter = { embedOne, embedMany } as unknown as QvacEmbeddingAdapter;
    const service = new QvacEmbeddingService(fakeModels(loadModel), adapter, MODEL_SOURCE, 16);

    await service.embed('text');
    await service.embedBatch(['text']);

    expect(loadModel).toHaveBeenCalledWith(MODEL_SOURCE);
  });
});
