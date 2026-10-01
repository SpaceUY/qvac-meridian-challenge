import { describe, expect, it, vi } from "vitest";

const { startQVACProviderMock, stopQVACProviderMock } = vi.hoisted(() => ({
  startQVACProviderMock: vi.fn(),
  stopQVACProviderMock: vi.fn(),
}));

vi.mock("@qvac/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@qvac/sdk")>();
  return {
    ...actual,
    startQVACProvider: startQVACProviderMock,
    stopQVACProvider: stopQVACProviderMock,
  };
});

const { startProvider, stopProvider } = await import("./qvacProviderAdapter.js");

describe("startProvider", () => {
  it("resolves with the provider's public key on success", async () => {
    startQVACProviderMock.mockResolvedValue({ type: "provide", success: true, publicKey: "pk-1" });

    await expect(startProvider()).resolves.toEqual({ publicKey: "pk-1" });
  });

  it("calls startQVACProvider with no params when no firewall is given", async () => {
    startQVACProviderMock.mockResolvedValue({ type: "provide", success: true, publicKey: "pk-1" });

    await startProvider();

    expect(startQVACProviderMock).toHaveBeenCalledWith(undefined);
  });

  it("passes an allow-list firewall through when given allowed consumer public keys", async () => {
    startQVACProviderMock.mockResolvedValue({ type: "provide", success: true, publicKey: "pk-1" });

    await startProvider({ allowedConsumerPublicKeys: ["consumer-pk"] });

    expect(startQVACProviderMock).toHaveBeenCalledWith({
      firewall: { mode: "allow", publicKeys: ["consumer-pk"] },
    });
  });

  it("throws with the SDK's error message when the SDK reports failure", async () => {
    startQVACProviderMock.mockResolvedValue({ type: "provide", success: false, error: "boom" });

    await expect(startProvider()).rejects.toThrow("boom");
  });

  it("throws when the SDK succeeds but returns no public key", async () => {
    startQVACProviderMock.mockResolvedValue({ type: "provide", success: true });

    await expect(startProvider()).rejects.toThrow(/public key/);
  });
});

describe("stopProvider", () => {
  it("resolves when the SDK reports success", async () => {
    stopQVACProviderMock.mockResolvedValue({ type: "stopProvide", success: true });

    await expect(stopProvider()).resolves.toBeUndefined();
  });

  it("throws with the SDK's error message when the SDK reports failure", async () => {
    stopQVACProviderMock.mockResolvedValue({ type: "stopProvide", success: false, error: "boom" });

    await expect(stopProvider()).rejects.toThrow("boom");
  });
});
