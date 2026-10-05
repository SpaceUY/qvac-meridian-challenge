import type { ModelManagementService } from '../../models/service/models.service.js';
import type { ModelSource } from '../../models/domain/types.js';
import type { EmbeddingPort } from '../domain/ports.js';
import type { QvacEmbeddingAdapter } from '../infra/qvacEmbeddingAdapter.js';
import { NativeEmbeddingProvider } from '../infra/nativeEmbedding/nativeEmbeddingProvider.js';
import { QvacEmbeddingService } from './qvacEmbeddingService.js';

/** What `ResilientEmbeddingService` needs from the native provider beyond `EmbeddingPort` - satisfied by the real `NativeEmbeddingProvider`, and the shape a test fake needs to implement. */
export interface NativeEmbeddingLike extends EmbeddingPort {
  ensureLoaded(): Promise<void>;
  readonly isCrashed: boolean;
  unload(): Promise<void>;
}

/**
 * `EmbeddingPort` that prefers the native `@qvac/embed-llamacpp` path and falls back to `@qvac/sdk`
 * when the native worker can't be used (see `docs/i4-native-addon-results.md`). The provider is
 * selected once, lazily, on first use; a mid-session native crash permanently fails over to the SDK
 * for the rest of the process - never a per-call re-evaluation or a retry loop. The last two
 * constructor args are test-only overrides (fake native provider / fake SDK factory).
 */
export class ResilientEmbeddingService implements EmbeddingPort {
  private sdkFallback?: QvacEmbeddingService;
  private activePromise?: Promise<EmbeddingPort>;

  constructor(
    models: ModelManagementService,
    adapter: QvacEmbeddingAdapter,
    modelSource: ModelSource,
    batchSize: number,
    expectedModelSize: number,
    private readonly nativeProvider: NativeEmbeddingLike = new NativeEmbeddingProvider(modelSource, expectedModelSize),
    private readonly createSdkFallback: () => QvacEmbeddingService = () =>
      new QvacEmbeddingService(models, adapter, modelSource, batchSize)
  ) {}

  private getSdkFallback(): QvacEmbeddingService {
    if (!this.sdkFallback) {
      this.sdkFallback = this.createSdkFallback();
    }
    return this.sdkFallback;
  }

  private async selectProvider(): Promise<EmbeddingPort> {
    try {
      await this.nativeProvider.ensureLoaded();
      console.log('[embedding] native @qvac/embed-llamacpp path is active for this session');
      return this.nativeProvider;
    } catch (err: unknown) {
      console.warn(
        '[embedding] native path failed to initialize, falling back to @qvac/sdk for this session:',
        err instanceof Error ? err.message : err
      );
      return this.getSdkFallback();
    }
  }

  private ensureActive(): Promise<EmbeddingPort> {
    if (!this.activePromise) {
      this.activePromise = this.selectProvider();
    }
    return this.activePromise;
  }

  /** On a native-worker crash, permanently repoints at the SDK fallback and retries `run` once. Any other error propagates as-is. */
  private async runWithFailover<T>(run: (port: EmbeddingPort) => Promise<T>): Promise<T> {
    const active = await this.ensureActive();
    try {
      return await run(active);
    } catch (err) {
      if (active === this.nativeProvider && this.nativeProvider.isCrashed) {
        console.warn(
          '[embedding] native worker crashed mid-session, failing over to @qvac/sdk for the remainder of this run:',
          err instanceof Error ? err.message : err
        );
        const fallback = this.getSdkFallback();
        this.activePromise = Promise.resolve(fallback);
        return run(fallback);
      }
      throw err;
    }
  }

  async embed(text: string): Promise<number[]> {
    return this.runWithFailover((port) => port.embed(text));
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return this.runWithFailover((port) => port.embedBatch(texts));
  }

  /** Unloads whichever provider(s) were actually constructed - never both unless a fallback transition happened mid-session, in which case both get a chance to release their resources. */
  async unload(): Promise<void> {
    await Promise.all([this.nativeProvider.unload(), this.sdkFallback?.unload()]);
  }
}
