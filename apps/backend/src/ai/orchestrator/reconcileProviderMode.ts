import type { DesiredProviderMode } from "./providerHealthMonitor.js";

/** The slice of `QvacChatSession` this needs - structural, so tests can pass a plain fake. */
export interface ProviderModeTarget {
  isBusy(): boolean;
  getDelegationInfo(): Promise<{ isDelegated: boolean } | undefined>;
  switchTo(mode: DesiredProviderMode): Promise<unknown>;
}

/**
 * Moves the chat model to `desired` if not already there and nothing would be interrupted; every "not now" outcome (busy, unknown mode) is safe since the next tick retries.
 * Re-reads the model's live mode each call (not a cached copy), so drift outside a tracked switch self-corrects.
 */
export async function reconcileProviderMode(
  target: ProviderModeTarget,
  desired: DesiredProviderMode,
): Promise<void> {
  if (target.isBusy()) return;

  const actual = await target.getDelegationInfo();
  if (!actual) return;
  if (target.isBusy()) return;
  if (actual.isDelegated === (desired === "delegated")) return;

  await target.switchTo(desired);
}
