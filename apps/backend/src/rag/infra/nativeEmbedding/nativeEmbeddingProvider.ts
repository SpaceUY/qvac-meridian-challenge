import type { EmbeddingPort } from '../../domain/ports.js';
import type { ModelSource } from '../../../models/domain/types.js';
import { createEmbeddingVectorValidator } from '../embeddingVectorValidation.js';
import { NativeEmbeddingClient } from './nativeEmbeddingClient.js';
import { DEFAULT_NATIVE_EMBED_CONFIG, resolveNativeEmbeddingModelPath } from './embeddingGemmaModel.js';

export { NativeWorkerError } from './nativeEmbeddingClient.js';

/**
 * `EmbeddingPort` backed by `@qvac/embed-llamacpp` run directly under the
 * Bare runtime - no `@qvac/sdk` anywhere in the call path. The persistent
 * worker protocol (`nativeEmbeddingClient.ts`/`bare/embedServer.js`)
 * generalizes the I.4 spike's one-shot worker
 * (`experiments/native-embed-spike/bare/embedWorker.js`, built for clean
 * benchmarking, not a long-lived server) into something suitable for
 * production.
 *
 * Loads whatever `modelSource` it's constructed with (resolved to a cached
 * GGUF path via `resolveNativeEmbeddingModelPath()`) - generalized from the
 * original I.4 integration, which always loaded EmbeddingGemma 300M Q4_0
 * regardless of what `ResilientEmbeddingService` was configured with.
 *
 * Lazy, cached load - mirrors `QvacEmbeddingService.ensureModel()`: the
 * worker spawns and the model loads on the first `embed()`/`embedBatch()`
 * call, once, and is reused for every call after. This class does not decide
 * whether the native path is even attempted, or what happens if it fails -
 * that policy lives in `ResilientEmbeddingService`. This class only knows
 * how to run the native path when asked, and to surface `NativeWorkerError`
 * (including `isCrashed`) when it can't.
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

  /**
   * No client-side queue here, unlike `QvacEmbeddingService.enqueue()` -
   * that one is load-bearing: the SDK's `llamacpp-embedding` worker handler
   * (`embed.js`) calls `model.run()` directly per RPC request with no
   * serialization of its own, so two concurrent `embed()` calls from Node
   * really would race the addon's single-job constraint and one would throw
   * "Cannot set new job" without a client-side queue forcing them one at a
   * time. Our worker (`bare/embedServer.js`) already serializes every
   * request it receives through its own `processing` promise chain before
   * calling `model.run()`, and `NativeEmbeddingClient.embedMany()` matches
   * responses to requests by id regardless of dispatch order - so sending
   * two `embedMany()` calls concurrently from here is already safe. Verified
   * directly: `NativeEmbeddingProvider.embedBatch()` and concurrent
   * `embed()` calls both work correctly against the real worker with no
   * queue at this layer.
   */
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
