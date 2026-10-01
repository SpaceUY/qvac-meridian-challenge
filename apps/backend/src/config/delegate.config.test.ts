import { describe, expect, it, vi } from "vitest";
import { resolveDelegateConfig, resolveHeartbeatConfig } from "./delegate.config.js";

const VALID_KEY = "a".repeat(64);

describe("resolveDelegateConfig", () => {
  it("returns undefined when no provider public key is set", () => {
    expect(resolveDelegateConfig({})).toBeUndefined();
  });

  it("treats an empty-string public key as unset", () => {
    expect(resolveDelegateConfig({ DELEGATE_PROVIDER_PUBLIC_KEY: "" })).toBeUndefined();
  });

  it("returns delegate options with fallbackToLocal always true and a default timeout when a valid provider key is set", () => {
    expect(resolveDelegateConfig({ DELEGATE_PROVIDER_PUBLIC_KEY: VALID_KEY })).toEqual({
      providerPublicKey: VALID_KEY,
      timeout: 60_000,
      fallbackToLocal: true,
    });
  });

  it("parses an optional numeric timeout override", () => {
    expect(
      resolveDelegateConfig({ DELEGATE_PROVIDER_PUBLIC_KEY: VALID_KEY, DELEGATE_TIMEOUT_MS: "5000" }),
    ).toEqual({
      providerPublicKey: VALID_KEY,
      timeout: 5000,
      fallbackToLocal: true,
    });
  });

  it("ignores a non-numeric timeout and falls back to the default instead of sending NaN", () => {
    expect(
      resolveDelegateConfig({ DELEGATE_PROVIDER_PUBLIC_KEY: VALID_KEY, DELEGATE_TIMEOUT_MS: "not-a-number" }),
    ).toEqual({
      providerPublicKey: VALID_KEY,
      timeout: 60_000,
      fallbackToLocal: true,
    });
  });

  it("ignores a timeout below the SDK's 100ms minimum and falls back to the default", () => {
    expect(
      resolveDelegateConfig({ DELEGATE_PROVIDER_PUBLIC_KEY: VALID_KEY, DELEGATE_TIMEOUT_MS: "50" }),
    ).toEqual({
      providerPublicKey: VALID_KEY,
      timeout: 60_000,
      fallbackToLocal: true,
    });
  });

  it("rejects a public key that isn't 64 hex characters, warns, and falls back to local (never throws)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(resolveDelegateConfig({ DELEGATE_PROVIDER_PUBLIC_KEY: "not-a-real-key" })).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it("trims surrounding whitespace from a valid public key (e.g. from a copy-paste)", () => {
    expect(resolveDelegateConfig({ DELEGATE_PROVIDER_PUBLIC_KEY: `  ${VALID_KEY}\n` })).toEqual({
      providerPublicKey: VALID_KEY,
      timeout: 60_000,
      fallbackToLocal: true,
    });
  });
});

describe("resolveHeartbeatConfig", () => {
  it("returns the defaults (15s interval, 3s timeout) when nothing is set", () => {
    expect(resolveHeartbeatConfig({})).toEqual({ intervalMs: 15_000, timeoutMs: 3_000 });
  });

  it("parses numeric overrides for both values", () => {
    expect(
      resolveHeartbeatConfig({
        DELEGATE_HEARTBEAT_INTERVAL_MS: "5000",
        DELEGATE_HEARTBEAT_TIMEOUT_MS: "1000",
      }),
    ).toEqual({ intervalMs: 5_000, timeoutMs: 1_000 });
  });

  it.each(["abc", "0", "-5", "999"])(
    "ignores the invalid interval %j, warns, and uses the default",
    (value) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(resolveHeartbeatConfig({ DELEGATE_HEARTBEAT_INTERVAL_MS: value }).intervalMs).toBe(15_000);
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockRestore();
    },
  );

  it.each(["abc", "0", "-5", "99"])(
    "ignores the invalid timeout %j, warns, and uses the default",
    (value) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(resolveHeartbeatConfig({ DELEGATE_HEARTBEAT_TIMEOUT_MS: value }).timeoutMs).toBe(3_000);
      expect(warn).toHaveBeenCalledTimes(1);

      warn.mockRestore();
    },
  );

  it("accepts the minimum values exactly (1000ms interval, 100ms timeout)", () => {
    expect(
      resolveHeartbeatConfig({
        DELEGATE_HEARTBEAT_INTERVAL_MS: "1000",
        DELEGATE_HEARTBEAT_TIMEOUT_MS: "100",
      }),
    ).toEqual({ intervalMs: 1_000, timeoutMs: 100 });
  });

  it("does not reject a timeout larger than the interval (the monitor skips overlapping ticks)", () => {
    expect(
      resolveHeartbeatConfig({
        DELEGATE_HEARTBEAT_INTERVAL_MS: "2000",
        DELEGATE_HEARTBEAT_TIMEOUT_MS: "9000",
      }),
    ).toEqual({ intervalMs: 2_000, timeoutMs: 9_000 });
  });
});
