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
 * `EmbeddingPort` that prefers the native `@qvac/embed-llamacpp` path
 * (`NativeEmbeddingProvider`) and falls back to the existing `@qvac/sdk`
 * path (`QvacEmbeddingService`, unmodified) when the native worker can't be
 * used - I.4 integration decision, see `docs/i4-native-addon-results.md`.
 *
 *   NativeEmbeddingProvider (primary)
 *          |
 *          | init/load fails, OR the worker crashes mid-session
 *          v
 *   QvacEmbeddingService (fallback, unchanged)
 *
 * The provider is selected exactly ONCE, lazily, on the first `embed()`/
 * `embedBatch()` call (same cached-promise pattern
 * `QvacEmbeddingService.ensureModel()` already uses) - every later call
 * reuses that decision. There is no per-call re-evaluation and no switching
 * back to native once a session has fallen over to the SDK: a crash mid-
 * session is treated as a one-way, permanent transition for the rest of
 * this process's life, not a retry loop.
 *
 * The first four constructor arguments match `QvacEmbeddingService`'s
 * exactly, so `server.ts`/`ingest.cli.ts` only need to swap the class name
 * at their one construction call site - the SDK fallback is built from
 * those same arguments, lazily, only if/when it's actually needed. The last
 * two arguments are test-only overrides (a fake native provider / fake SDK
 * factory) - production call sites never pass them.
 *
 * I.4 LIMITATION: `modelSource`/`batchSize` only ever reach the SDK
 * fallback. `NativeEmbeddingProvider` always loads EmbeddingGemma 300M Q4_0
 * (see `infra/nativeEmbedding/embeddingGemmaModel.ts`) regardless of what
 * `modelSource` this class was constructed with - it is not a general
 * "load any registry model natively" path. Fine today because
 * `EMBEDDING_MODEL_SOURCE` (`config/models.config.ts`) is the only model
 * either path is ever asked to load; would need addressing before this
 * class is used with more than one embedding model.
 */
export class ResilientEmbeddingService implements EmbeddingPort {
  private sdkFallback?: QvacEmbeddingService;
  private activePromise?: Promise<EmbeddingPort>;

  constructor(
    models: ModelManagementService,
    adapter: QvacEmbeddingAdapter,
    modelSource: ModelSource,
    batchSize: number,
    private readonly nativeProvider: NativeEmbeddingLike = new NativeEmbeddingProvider(),
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

  /**
   * Runs `run` against whichever provider is currently active. If that's the
   * native one and the call failed because its worker crashed, this
   * permanently repoints `activePromise` at the SDK fallback and retries
   * `run` once against it, so the caller sees a successful result instead of
   * a spurious failure caused purely by an internal fallback transition.
   * Any other error (a real embedding failure, not a crash) is not retried -
   * it propagates exactly like it would from either provider alone.
   */
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
