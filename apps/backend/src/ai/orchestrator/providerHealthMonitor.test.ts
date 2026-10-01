import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { ProviderHealthMonitor, type DesiredProviderMode } from "./providerHealthMonitor.js";
import type { ProviderHealthState } from "./providerHealth.js";

const INTERVAL_MS = 15_000;
const TIMEOUT_MS = 3_000;

interface Harness {
  monitor: ProviderHealthMonitor;
  heartbeat: Mock<() => Promise<void>>;
  reconcile: Mock<(desired: DesiredProviderMode) => Promise<void>>;
}

function buildMonitor(
  overrides: {
    initialState?: ProviderHealthState;
    timeoutMs?: number;
    now?: () => number;
    shouldSkipTick?: () => boolean;
  } = {},
): Harness {
  const heartbeat = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const reconcile = vi.fn<(desired: DesiredProviderMode) => Promise<void>>().mockResolvedValue(undefined);
  const monitor = new ProviderHealthMonitor({
    intervalMs: INTERVAL_MS,
    timeoutMs: overrides.timeoutMs ?? TIMEOUT_MS,
    initialState: overrides.initialState ?? "up",
    heartbeat,
    reconcile,
    ...(overrides.now ? { now: overrides.now } : {}),
    ...(overrides.shouldSkipTick ? { shouldSkipTick: overrides.shouldSkipTick } : {}),
  });
  return { monitor, heartbeat, reconcile };
}

describe("ProviderHealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sends a heartbeat once per interval, not before", async () => {
    const { monitor, heartbeat } = buildMonitor();
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS - 1);
    expect(heartbeat).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it("is idempotent to start twice (still one heartbeat per interval)", async () => {
    const { monitor, heartbeat } = buildMonitor();
    monitor.start();
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(heartbeat).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it("stops ticking after stop()", async () => {
    const { monitor, heartbeat } = buildMonitor();
    monitor.start();
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    monitor.stop();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(heartbeat).toHaveBeenCalledTimes(1);
  });

  it("asks for the delegated mode on every tick while the provider is up (level-triggered)", async () => {
    const { monitor, reconcile } = buildMonitor();
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 3);

    expect(reconcile.mock.calls).toEqual([["delegated"], ["delegated"], ["delegated"]]);
    monitor.stop();
  });

  it("asks for local on the third consecutive failure and keeps asking on every later tick", async () => {
    const { monitor, heartbeat, reconcile } = buildMonitor();
    heartbeat.mockRejectedValue(new Error("provider offline"));
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);

    expect(reconcile.mock.calls.map(([desired]) => desired)).toEqual([
      "delegated",
      "delegated",
      "local",
      "local",
    ]);
    expect(monitor.getHealth().state).toBe("down");
    monitor.stop();
  });

  it("asks for delegated again after two consecutive successes once down", async () => {
    const { monitor, heartbeat, reconcile } = buildMonitor({ initialState: "down" });
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(reconcile.mock.calls.map(([desired]) => desired)).toEqual(["local", "delegated"]);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it("skips a tick while the previous heartbeat is still pending (timeout larger than the interval)", async () => {
    const { monitor, heartbeat } = buildMonitor({ timeoutMs: INTERVAL_MS * 10 });
    heartbeat.mockImplementation(() => new Promise<void>(() => {}));
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);

    expect(heartbeat).toHaveBeenCalledTimes(1);
    monitor.stop();
  });

  it("counts a heartbeat that never settles as a failure once the timeout elapses, then keeps ticking", async () => {
    const { monitor, heartbeat, reconcile } = buildMonitor();
    heartbeat.mockImplementation(() => new Promise<void>(() => {}));
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS + TIMEOUT_MS);
    expect(monitor.getHealth().consecutiveFailures).toBe(1);
    expect(reconcile).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);
    expect(heartbeat).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it("logs a failing reconcile and keeps ticking (a failed switch is retried on the next tick)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { monitor, reconcile } = buildMonitor();
    reconcile.mockRejectedValueOnce(new Error("local load failed"));
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 2);

    expect(error).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(2);
    monitor.stop();
  });

  it("sends no heartbeat, records nothing and does not reconcile while shouldSkipTick is true, then resumes", async () => {
    let skip = true;
    const { monitor, heartbeat, reconcile } = buildMonitor({ shouldSkipTick: () => skip });
    heartbeat.mockRejectedValue(new Error("provider offline"));
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS * 4);

    expect(heartbeat).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(monitor.getHealth()).toEqual({ state: "up", consecutiveFailures: 0 });

    skip = false;
    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(heartbeat).toHaveBeenCalledTimes(1);
    expect(reconcile.mock.calls).toEqual([["delegated"]]);
    expect(monitor.getHealth().consecutiveFailures).toBe(1);
    monitor.stop();
  });

  it("measures the latency of a successful heartbeat with the injected clock", async () => {
    const now = vi.fn<() => number>().mockReturnValueOnce(1_000).mockReturnValueOnce(1_042);
    const { monitor } = buildMonitor({ now });
    monitor.start();

    await vi.advanceTimersByTimeAsync(INTERVAL_MS);

    expect(monitor.getHealth().lastLatencyMs).toBe(42);
    monitor.stop();
  });
});
