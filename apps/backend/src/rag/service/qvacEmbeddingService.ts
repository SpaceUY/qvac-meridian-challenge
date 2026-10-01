import type { ModelManagementService } from '../../models/service/models.service.js';
import type { ModelSource } from '../../models/domain/types.js';
import type { EmbeddingPort } from '../domain/ports.js';
import { EmbeddingDimensionMismatchError, MalformedEmbeddingError } from '../domain/errors.js';
import type { QvacEmbeddingAdapter } from '../infra/qvacEmbeddingAdapter.js';

/**
 * `EmbeddingPort` backed by a local QVAC embedding model. Owns the model's
 * load lifecycle (same cached-promise `ensureModel()` pattern as
 * `ChatQVAC`/`TtsService`) so the model loads once and is reused across
 * every `embed()`/`embedBatch()` call instead of per request. Query
 * embeddings (`embed`) and document embeddings (`embedBatch`) both go
 * through this same cached model, so they're never accidentally produced
 * by two different models.
 *
 * The first vector this instance ever produces fixes the expected
 * dimension; anything after that with a different length, or containing a
 * non-finite number, is rejected rather than handed to the vector store.
 *
 * QVAC's llama.cpp embedding engine runs one job per model at a time
 * (`GGMLBert`'s exclusive run queue) - a second concurrent `embed()` call
 * against the same loaded model fails with "Cannot set new job". `queue`
 * below serializes every SDK call this instance makes so concurrent
 * `embed()`/`embedBatch()` callers (e.g. embedding several fixture chunks
 * via `Promise.all`) queue up instead of racing the engine.
 */
export class QvacEmbeddingService implements EmbeddingPort {
  private modelIdPromise?: Promise<string>;
  private dimension?: number;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly models: ModelManagementService,
    private readonly adapter: QvacEmbeddingAdapter,
    private readonly modelSource: ModelSource,
    private readonly batchSize: number
  ) {}

  private async ensureModel(): Promise<string> {
    if (!this.modelIdPromise) {
      this.modelIdPromise = this.models
        .loadModel(this.modelSource)
        .then((loaded) => loaded.modelId)
        .catch((error: unknown) => {
          this.modelIdPromise = undefined;
          throw error;
        });
    }
    return this.modelIdPromise;
  }

  /** Chains `task` onto the shared queue so at most one SDK embed call for this model is ever in flight. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async embed(text: string): Promise<number[]> {
    const modelId = await this.ensureModel();
    const vector = await this.enqueue(() => this.adapter.embedOne(modelId, text));
    return this.validate(vector);
  }

  /** Splits `texts` into `batchSize`-sized chunks, one `embedMany()` call per chunk, queued to bound peak memory and respect the engine's single-job limit. */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const modelId = await this.ensureModel();

    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const embedded = await this.enqueue(() => this.adapter.embedMany(modelId, batch));
      vectors.push(...embedded.map((vector) => this.validate(vector)));
    }
    return vectors;
  }

  private validate(vector: number[]): number[] {
    if (vector.length === 0 || !vector.every((value) => Number.isFinite(value))) {
      throw new MalformedEmbeddingError(vector.length === 0 ? 'empty vector' : 'non-finite value in vector');
    }

    if (this.dimension === undefined) {
      this.dimension = vector.length;
    } else if (vector.length !== this.dimension) {
      throw new EmbeddingDimensionMismatchError(this.dimension, vector.length);
    }

    return vector;
  }
}
