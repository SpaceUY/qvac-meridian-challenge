import {
  createHealthTracker,
  type HealthTracker,
  type ProviderHealth,
  type ProviderHealthState,
} from "./providerHealth.js";

export type DesiredProviderMode = "delegated" | "local";

export interface ProviderHealthMonitorOptions {
  intervalMs: number;
  /** Also enforced here, not only by the SDK: a heartbeat promise that never settles must still count as a failure. */
  timeoutMs: number;
  initialState: ProviderHealthState;
  heartbeat: () => Promise<void>;
  /** Called after every heartbeat (not only on a state change) with the mode the provider's health calls for. */
  reconcile: (desired: DesiredProviderMode) => Promise<void>;
  /** Checked at the start of every tick; when it returns `true` the tick sends no heartbeat, records nothing and does not reconcile - e.g. while a chat is in flight, so a heartbeat probe never disturbs the connection it is using. */
  shouldSkipTick?: () => boolean;
  now?: () => number;
}

/**
 * Polls a provider heartbeat on a timer and asks `reconcile` to move the
 * chat model to whichever mode the provider's health calls for. The
 * request is level-triggered - repeated every tick - so a switch that
 * failed or was deferred because the model was busy is simply retried by
 * the next tick, with no separate retry code.
 */
export class ProviderHealthMonitor {
  private readonly tracker: HealthTracker;
  private readonly now: () => number;
  private timer?: NodeJS.Timeout;
  private tickInFlight = false;

  constructor(private readonly options: ProviderHealthMonitorOptions) {
    this.tracker = createHealthTracker({ initialState: options.initialState });
    this.now = options.now ?? Date.now;
  }

  /** Idempotent. The timer is `unref`'d so monitoring never keeps the process alive. */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  getHealth(): ProviderHealth {
    return this.tracker.snapshot();
  }

  private async tick(): Promise<void> {
    if (this.tickInFlight) return;
    this.tickInFlight = true;
    try {
      if (this.options.shouldSkipTick?.()) return;
      const startedAt = this.now();
      const ok = await this.sendHeartbeat();
      const { state } = this.tracker.record(ok, ok ? this.now() - startedAt : undefined);
      await this.options.reconcile(state === "up" ? "delegated" : "local");
    } catch (error) {
      console.error("[provider-health] switching the chat model failed; will retry on the next tick", error);
    } finally {
      this.tickInFlight = false;
    }
  }

  private async sendHeartbeat(): Promise<boolean> {
    let timeout: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("heartbeat timed out")), this.options.timeoutMs);
    });
    try {
      await Promise.race([this.options.heartbeat(), timedOut]);
      return true;
    } catch {
      console.debug("[provider-health] heartbeat failed");
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }
}
