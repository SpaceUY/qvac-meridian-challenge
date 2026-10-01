import { describe, expect, it, vi } from "vitest";
import { reconcileProviderMode, type ProviderModeTarget } from "./reconcileProviderMode.js";

function buildTarget(overrides: { busy?: boolean; live?: { isDelegated: boolean } } = {}) {
  const getDelegationInfo = vi.fn().mockResolvedValue(overrides.live);
  const switchTo = vi.fn().mockResolvedValue("fake-model");
  const target: ProviderModeTarget = {
    isBusy: () => overrides.busy ?? false,
    getDelegationInfo,
    switchTo,
  };
  return { target, getDelegationInfo, switchTo };
}

describe("reconcileProviderMode", () => {
  it("does nothing, and reads nothing, while the chat model is busy, even when the modes differ", async () => {
    const { target, getDelegationInfo, switchTo } = buildTarget({ busy: true, live: { isDelegated: true } });

    await reconcileProviderMode(target, "local");

    expect(switchTo).not.toHaveBeenCalled();
    expect(getDelegationInfo).not.toHaveBeenCalled();
  });

  it("does not switch when the live mode is unknown", async () => {
    const { target, getDelegationInfo, switchTo } = buildTarget({ live: undefined });

    await reconcileProviderMode(target, "local");

    expect(getDelegationInfo).toHaveBeenCalledTimes(1);
    expect(switchTo).not.toHaveBeenCalled();
  });

  it("does not switch when a chat started while the live mode was being read", async () => {
    let busy = false;
    const switchTo = vi.fn().mockResolvedValue("fake-model");
    const target: ProviderModeTarget = {
      isBusy: () => busy,
      getDelegationInfo: async () => {
        busy = true;
        return { isDelegated: false };
      },
      switchTo,
    };

    await reconcileProviderMode(target, "delegated");

    expect(switchTo).not.toHaveBeenCalled();
  });

  it("acts on the live mode: switches to delegated when the live mode is local", async () => {
    const { target, getDelegationInfo, switchTo } = buildTarget({ live: { isDelegated: false } });

    await reconcileProviderMode(target, "delegated");

    expect(getDelegationInfo).toHaveBeenCalledTimes(1);
    expect(switchTo).toHaveBeenCalledWith("delegated");
  });

  it("does nothing when the live mode already matches (delegated)", async () => {
    const { target, switchTo } = buildTarget({ live: { isDelegated: true } });

    await reconcileProviderMode(target, "delegated");

    expect(switchTo).not.toHaveBeenCalled();
  });

  it("does nothing when the live mode already matches (local)", async () => {
    const { target, switchTo } = buildTarget({ live: { isDelegated: false } });

    await reconcileProviderMode(target, "local");

    expect(switchTo).not.toHaveBeenCalled();
  });

  it("switches to local when delegated but the provider is down", async () => {
    const { target, switchTo } = buildTarget({ live: { isDelegated: true } });

    await reconcileProviderMode(target, "local");

    expect(switchTo).toHaveBeenCalledWith("local");
  });

  it("switches back to delegated when running locally and the provider is back", async () => {
    const { target, switchTo } = buildTarget({ live: { isDelegated: false } });

    await reconcileProviderMode(target, "delegated");

    expect(switchTo).toHaveBeenCalledWith("delegated");
  });

  it("propagates a failing switch so the monitor can log it and retry next tick", async () => {
    const { target, switchTo } = buildTarget({ live: { isDelegated: true } });
    switchTo.mockRejectedValue(new Error("local load failed"));

    await expect(reconcileProviderMode(target, "local")).rejects.toThrow("local load failed");
  });
});
