import { startQVACProvider, stopQVACProvider } from "@qvac/sdk";

/** The other file (besides `qvacRuntimeAdapter.ts`) that imports `@qvac/sdk` - serving compute to peers is a distinct concern from the load/infer lifecycle, kept out of `ModelRuntimePort`. */
export interface ProviderFirewall {
  /** Only these public keys may delegate to this provider; every other consumer is rejected. */
  allowedConsumerPublicKeys: string[];
}

/** Starts this process as a QVAC provider. Throws instead of returning `success: false`, so callers never null-check a "successful" result. */
export async function startProvider(firewall?: ProviderFirewall): Promise<{ publicKey: string }> {
  const response = await startQVACProvider(
    firewall
      ? { firewall: { mode: "allow", publicKeys: firewall.allowedConsumerPublicKeys } }
      : undefined,
  );
  if (!response.success || !response.publicKey) {
    throw new Error(response.error ?? "startQVACProvider() did not return a public key");
  }
  return { publicKey: response.publicKey };
}

/** Stops the running provider service. Idempotent - safe to call with no provider running (per `stopQVACProvider()`'s own contract). */
export async function stopProvider(): Promise<void> {
  const response = await stopQVACProvider();
  if (!response.success) {
    throw new Error(response.error ?? "stopQVACProvider() failed");
  }
}
