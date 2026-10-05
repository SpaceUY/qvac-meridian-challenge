import type { EmbeddingPort } from '../../domain/ports.js';
import type { ModelSource } from '../../../models/domain/types.js';
import { createEmbeddingVectorValidator } from '../embeddingVectorValidation.js';
import { NativeEmbeddingClient } from './nativeEmbeddingClient.js';
import { DEFAULT_NATIVE_EMBED_CONFIG, resolveNativeEmbeddingModelPath } from './embeddingGemmaModel.js';

export { NativeWorkerError } from './nativeEmbeddingClient.js';

/**
 * `EmbeddingPort` backed by `@qvac/embed-llamacpp` under the Bare runtime - no `@qvac/sdk` in the
 * call path. Lazy, cached load (mirrors `QvacEmbeddingService.ensureModel()`). Doesn't decide
 * whether the native path is attempted or what happens if it fails - that's `ResilientEmbeddingService`'s job.
 */
export class NativeEmbeddingProvider implements EmbeddingPort {
  private readonly client = new NativeEmbeddingClient();
  private readonly validate = createEmbeddingVectorValidator();
  private loadPromise?: Promise<void>;

  constructor(
    private readonly modelSource: ModelSource,
    private readonly expectedSize: number
  ) {}

  /** Spawns the worker and loads the model if that hasn't happened yet; otherwise resolves immediately. Rejects (and forgets the attempt, so a later call retries) if the worker fails to start or load. */
  async ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      const modelPath = resolveNativeEmbeddingModelPath(this.modelSource, this.expectedSize);
      this.loadPromise = this.client.start(modelPath, DEFAULT_NATIVE_EMBED_CONFIG).catch((err: unknown) => {
        this.loadPromise = undefined;
        throw err;
      });
    }
    return this.loadPromise;
  }

  /** No client-side queue needed (unlike `QvacEmbeddingService.enqueue()`): `embedServer.js` already serializes requests before calling `model.run()`, and responses are matched by id regardless of order. */
  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const [result] = await this.client.embedMany([text]);
    return this.validate(result.embedding);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    await this.ensureLoaded();
    const results = await this.client.embedMany(texts);
    if (results.length !== texts.length) {
      throw new Error(`native embed worker returned ${results.length} vectors for ${texts.length} texts`);
    }
    return results.map((result) => this.validate(result.embedding));
  }

  /** True once the underlying worker has exited unexpectedly or its pipe errored. `ResilientEmbeddingService` checks this after a failed call to decide whether to fail over permanently - this class never restarts or retries on its own. */
  get isCrashed(): boolean {
    return this.client.isCrashed;
  }

  /** No-op if the worker was never started. Idempotent, like `QvacEmbeddingService.unload()`. */
  async unload(): Promise<void> {
    if (!this.loadPromise) return;
    await this.client.shutdown();
  }
}
