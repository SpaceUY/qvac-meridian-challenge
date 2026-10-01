
export interface ChatReadinessSource {
  getStatus(): { status: "idle" | "loading" | "ready" | "error" };
  preload(): Promise<void>;
}

export interface EmbeddingReadinessSource {
  embed(text: string): Promise<number[]>;
}

export interface ReadinessSnapshot {
  ready: boolean;
  chatStatus: "idle" | "loading" | "ready" | "error";
  embeddingReady: boolean;
}

/**
 * The one place that decides whether this backend is ready to serve
 * grounded answers. `GET /health` and `GET /v1/models` both call `check()`
 * so they can never disagree - and per-endpoint self-healing (retrying a
 * stuck preload, retrying a failed embedding warm-up) only has to be
 * written once.
 */
export class ReadinessService {
  private embeddingReady = false;
  private embeddingWarmupPromise: Promise<void> | undefined;

  constructor(
    private readonly chatService: ChatReadinessSource,
    private readonly embeddingService: EmbeddingReadinessSource,
  ) {}

  /** Fire-and-forget initial warm-up of both models. Call once, at server startup. */
  start(): void {
    this.chatService.preload().catch((err: unknown) => {
      console.error("[readiness] initial chat model preload failed", err);
    });
    this.warmUpEmbedding().catch(() => {
      // Logged inside warmUpEmbedding() already.
    });
  }

  private warmUpEmbedding(): Promise<void> {
    if (!this.embeddingWarmupPromise) {
      this.embeddingWarmupPromise = this.embeddingService
        .embed("readiness warm-up")
        .then(() => {
          this.embeddingReady = true;
        })
        .catch((err: unknown) => {
          console.error("[readiness] embedding model warm-up failed", err);
          // Clear so the next check() starts a fresh attempt instead of
          // being stuck on this rejected promise forever.
          this.embeddingWarmupPromise = undefined;
          throw err;
        });
    }
    return this.embeddingWarmupPromise;
  }

  /**
   * Re-checks status, retrying a previously-failed chat preload and
   * kicking off the embedding warm-up if it hasn't succeeded yet. Has
   * side effects on purpose - this is what makes both endpoints
   * self-healing across polls instead of latching on one transient
   * failure forever.
   */
  check(): ReadinessSnapshot {
    let chatStatus = this.chatService.getStatus().status;
    if (chatStatus === "error") {
      // preload() sets status to "loading" synchronously before its first
      // await, so re-reading getStatus() right after this call reflects
      // the freshly-kicked attempt instead of the stale "error".
      this.chatService.preload().catch((err: unknown) => {
        console.error("[readiness] chat model preload retry failed", err);
      });
      chatStatus = this.chatService.getStatus().status;
    }
    if (!this.embeddingReady) {
      this.warmUpEmbedding().catch(() => {
        // Logged inside warmUpEmbedding() already.
      });
    }
    return { ready: chatStatus === "ready" && this.embeddingReady, chatStatus, embeddingReady: this.embeddingReady };
  }
}
