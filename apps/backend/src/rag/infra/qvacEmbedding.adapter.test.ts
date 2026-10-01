import { describe, expect, it, vi, type Mock } from 'vitest';
import { QvacEmbeddingAdapter } from './qvacEmbedding.adapter.js';
import type { ModelManagementService } from '../../models/service/models.service.js';
import type { ModelSource } from '../../models/domain/types.js';

const SOURCE: ModelSource = {
  kind: 'registry',
  registryPath: 'p',
  registrySource: 'hf',
  modelType: 'llamacpp-embedding'
};

/** Minimal stand-in for `ModelManagementService`: only the two methods the adapter touches. */
function fakeService() {
  const loadModel = vi.fn(() =>
    Object.assign(Promise.resolve({ modelId: 'emb-1', source: SOURCE, loadedAt: new Date() }), {
      requestId: 'req-1'
    })
  );
  const embed = vi.fn(async (_modelId: string, texts: string[]) => texts.map((_t, i) => [i, i + 1]));
  const unloadModel = vi.fn(async () => {});
  return { loadModel, embed, unloadModel } as unknown as ModelManagementService;
}

describe('QvacEmbeddingAdapter', () => {
  it('loads the model once and reuses it across calls', async () => {
    const service = fakeService();
    const adapter = new QvacEmbeddingAdapter(service, SOURCE);

    await adapter.embedBatch(['a']);
    await adapter.embedBatch(['b']);

    expect(service.loadModel).toHaveBeenCalledTimes(1);
  });

  it('returns one vector per input, in input order', async () => {
    const adapter = new QvacEmbeddingAdapter(fakeService(), SOURCE);

    expect(await adapter.embedBatch(['a', 'b', 'c'])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  it('embed() unwraps the single-element batch', async () => {
    const adapter = new QvacEmbeddingAdapter(fakeService(), SOURCE);

    expect(await adapter.embed('a')).toEqual([0, 1]);
  });

  it('embedBatch([]) short-circuits without loading the model', async () => {
    const service = fakeService();
    const adapter = new QvacEmbeddingAdapter(service, SOURCE);

    expect(await adapter.embedBatch([])).toEqual([]);
    expect(service.loadModel).not.toHaveBeenCalled();
  });

  it('retries the load if the first attempt failed', async () => {
    const service = fakeService();
    const loadModel = service.loadModel as unknown as Mock;
    loadModel.mockImplementationOnce(() =>
      Object.assign(Promise.reject(new Error('download interrupted')), { requestId: 'req-0' })
    );
    const adapter = new QvacEmbeddingAdapter(service, SOURCE);

    await expect(adapter.embedBatch(['a'])).rejects.toThrow('download interrupted');
    expect(await adapter.embedBatch(['a'])).toEqual([[0, 1]]);
    expect(loadModel).toHaveBeenCalledTimes(2);
  });
});
