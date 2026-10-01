import { startQVACProvider, stopQVACProvider } from "@qvac/sdk";

/**
 * The second (and only other) file that imports `@qvac/sdk` for this
 * feature, alongside `qvacRuntimeAdapter.ts` - serving compute to peers is
 * a distinct concern from the model load/infer lifecycle that adapter
 * owns, so it gets its own narrow file instead of bloating
 * `ModelRuntimePort` for a capability only `models/provider.ts` calls.
 */
export interface ProviderFirewall {
  /** Only these public keys may delegate to this provider; every other consumer is rejected. */
  allowedConsumerPublicKeys: string[];
}

/**
 * Starts this process as a QVAC provider, reachable over the DHT by public
 * key. Throws instead of returning a `success: false` response, so callers
 * never have to null-check a "successful" result.
 */
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
