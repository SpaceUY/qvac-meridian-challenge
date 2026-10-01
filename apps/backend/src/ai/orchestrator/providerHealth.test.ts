import { describe, expect, it } from "vitest";
import { createHealthTracker } from "./providerHealth.js";

describe("createHealthTracker", () => {
  it("stays up below the failure threshold and reports no change", () => {
    const tracker = createHealthTracker({ initialState: "up" });

    expect(tracker.record(false)).toEqual({ state: "up", changed: false });
    expect(tracker.record(false)).toEqual({ state: "up", changed: false });
  });

  it("goes down on the third consecutive failure and reports the change once", () => {
    const tracker = createHealthTracker({ initialState: "up" });
    tracker.record(false);
    tracker.record(false);

    expect(tracker.record(false)).toEqual({ state: "down", changed: true });
    expect(tracker.record(false)).toEqual({ state: "down", changed: false });
  });

  it("resets the failure count when a success arrives", () => {
    const tracker = createHealthTracker({ initialState: "up" });
    tracker.record(false);
    tracker.record(false);
    tracker.record(true);
    tracker.record(false);

    expect(tracker.record(false).state).toBe("up");
  });

  it("does not come back up on a single success", () => {
    const tracker = createHealthTracker({ initialState: "down" });

    expect(tracker.record(true)).toEqual({ state: "down", changed: false });
  });

  it("comes back up on the second consecutive success and reports the change", () => {
    const tracker = createHealthTracker({ initialState: "down" });
    tracker.record(true);

    expect(tracker.record(true)).toEqual({ state: "up", changed: true });
  });

  it("resets the success count when a failure arrives while down", () => {
    const tracker = createHealthTracker({ initialState: "down" });
    tracker.record(true);
    tracker.record(false);

    expect(tracker.record(true).state).toBe("down");
  });

  it("never flips state for a flapping provider (alternating failure/success)", () => {
    const upTracker = createHealthTracker({ initialState: "up" });
    const downTracker = createHealthTracker({ initialState: "down" });

    for (let i = 0; i < 20; i++) {
      const ok = i % 2 === 1;
      expect(upTracker.record(ok).changed).toBe(false);
      expect(downTracker.record(!ok).changed).toBe(false);
    }
    expect(upTracker.snapshot().state).toBe("up");
    expect(downTracker.snapshot().state).toBe("down");
  });

  it("honors custom thresholds", () => {
    const tracker = createHealthTracker({ initialState: "up", downAfter: 1, upAfter: 1 });

    expect(tracker.record(false)).toEqual({ state: "down", changed: true });
    expect(tracker.record(true)).toEqual({ state: "up", changed: true });
  });

  it("snapshots the last success time (ISO), the last latency, and the failure streak", () => {
    const tracker = createHealthTracker({
      initialState: "up",
      now: () => new Date("2026-09-29T10:00:00.000Z"),
    });

    tracker.record(true, 42);
    tracker.record(false);
    tracker.record(false);

    expect(tracker.snapshot()).toEqual({
      state: "up",
      consecutiveFailures: 2,
      lastSuccessAt: "2026-09-29T10:00:00.000Z",
      lastLatencyMs: 42,
    });
  });

  it("omits lastSuccessAt and lastLatencyMs until a success has been recorded", () => {
    const tracker = createHealthTracker({ initialState: "up" });
    tracker.record(false);

    expect(tracker.snapshot()).toEqual({ state: "up", consecutiveFailures: 1 });
  });
});
