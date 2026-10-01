import type { EmbeddingPort } from '../domain/ports.js';
import type { ModelSource } from '../../models/domain/types.js';
import type { ModelManagementService } from '../../models/service/models.service.js';
import { EMBEDDING_MODEL_SOURCE } from '../../config/models.config.js';

/**
 * Real `EmbeddingPort`, backed by a QVAC embeddings model through
 * `ModelManagementService` - it never imports `@qvac/sdk` itself, so the
 * SDK stays behind `models/infra/qvacRuntimeAdapter.ts` and the model's
 * lifecycle stays registered with the one service that owns `unloadAll()`
 * and `close()`.
 *
 * The model loads lazily on first use and is then reused: constructing this
 * adapter must not trigger a ~277MB download. `loadPromise` (not a
 * `modelId` string) is what's memoized, so two concurrent first calls await
 * the same load instead of racing into two. A FAILED load is forgotten, so
 * the next call retries - same pattern as `ChatQVAC.ensureModel()`.
 */
export class QvacEmbeddingAdapter implements EmbeddingPort {
  private loadPromise?: Promise<string>;

  constructor(
    private readonly service: ModelManagementService,
    private readonly source: ModelSource = EMBEDDING_MODEL_SOURCE
  ) {}

  /** Loads the embeddings model if needed and returns its `modelId`. Idempotent and safe to call concurrently. */
  async ensureModel(): Promise<string> {
    this.loadPromise ??= this.service
      .loadModel(this.source)
      .then((loaded) => loaded.modelId)
      .catch((error: unknown) => {
        // Forget the failed attempt so the next call retries. Otherwise one
        // interrupted download would leave this adapter broken until the
        // process restarts - and the server process lives for hours.
        this.loadPromise = undefined;
        throw error;
      });
    return this.loadPromise;
  }

  async embed(text: string): Promise<number[]> {
    const [vector] = await this.embedBatch([text]);
    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    // Short-circuited before `ensureModel()` on purpose: an empty ingest run
    // should not download or load a model to produce an empty answer.
    if (texts.length === 0) return [];

    const modelId = await this.ensureModel();
    return this.service.embed(modelId, texts);
  }

  /**
   * Releases the embeddings model. For the ingest CLI, which is done with
   * it once the table is written; the long-running server keeps it loaded
   * alongside the chat model instead, since swapping models per question
   * would make replies unusably slow. Safe to call when nothing was loaded.
   */
  async unload(): Promise<void> {
    if (!this.loadPromise) return;
    const modelId = await this.loadPromise;
    this.loadPromise = undefined;
    await this.service.unloadModel(modelId);
  }
}
