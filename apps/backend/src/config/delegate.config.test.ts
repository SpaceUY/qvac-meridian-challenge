import { describe, expect, it, vi } from "vitest";
import { resolveDelegateConfig } from "./delegate.config.js";

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
