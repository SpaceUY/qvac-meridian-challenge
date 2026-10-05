export type ProviderHealthState = "up" | "down";

/** What `GET /api/chat/status` reports as `providerHealth`. */
export interface ProviderHealth {
  state: ProviderHealthState;
  consecutiveFailures: number;
  /** ISO timestamp of the last successful heartbeat. Absent until one has succeeded. */
  lastSuccessAt?: string;
  /** Round-trip time of the last successful heartbeat. Absent until one has succeeded. */
  lastLatencyMs?: number;
}

export interface HealthRecordResult {
  state: ProviderHealthState;
  /** `true` only for the result that flipped `state`. */
  changed: boolean;
}

export interface HealthTracker {
  record(ok: boolean, latencyMs?: number): HealthRecordResult;
  snapshot(): ProviderHealth;
}

export interface HealthTrackerOptions {
  initialState: ProviderHealthState;
  downAfter?: number;
  upAfter?: number;
  now?: () => Date;
}

export const DOWN_AFTER_FAILURES = 3;
export const UP_AFTER_SUCCESSES = 2;

/** Hysteresis state machine: `downAfter`/`upAfter` consecutive results flip state; an opposite-kind result resets the streak, so one dropped heartbeat never triggers a reload. */
export function createHealthTracker({
  initialState,
  downAfter = DOWN_AFTER_FAILURES,
  upAfter = UP_AFTER_SUCCESSES,
  now = () => new Date(),
}: HealthTrackerOptions): HealthTracker {
  let state = initialState;
  let consecutiveFailures = 0;
  let consecutiveSuccesses = 0;
  let lastSuccessAt: string | undefined;
  let lastLatencyMs: number | undefined;

  return {
    record(ok, latencyMs) {
      const previous = state;
      if (ok) {
        consecutiveFailures = 0;
        consecutiveSuccesses += 1;
        lastSuccessAt = now().toISOString();
        if (latencyMs !== undefined) lastLatencyMs = latencyMs;
        if (state === "down" && consecutiveSuccesses >= upAfter) state = "up";
      } else {
        consecutiveSuccesses = 0;
        consecutiveFailures += 1;
        if (state === "up" && consecutiveFailures >= downAfter) state = "down";
      }
      return { state, changed: state !== previous };
    },
    snapshot() {
      return {
        state,
        consecutiveFailures,
        ...(lastSuccessAt ? { lastSuccessAt } : {}),
        ...(lastLatencyMs !== undefined ? { lastLatencyMs } : {}),
      };
    },
  };
}
