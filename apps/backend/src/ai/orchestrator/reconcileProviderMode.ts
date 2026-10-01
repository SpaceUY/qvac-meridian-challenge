import type { DesiredProviderMode } from "./providerHealthMonitor.js";

/** The slice of `ChatQVAC` this needs - structural, so tests can pass a plain fake. */
export interface ProviderModeTarget {
  isBusy(): boolean;
  getDelegationInfo(): Promise<{ isDelegated: boolean } | undefined>;
  switchTo(mode: DesiredProviderMode): Promise<unknown>;
}

/**
 * Moves the chat model to `desired` if it isn't there already and nothing
 * would be interrupted. Called on every monitor tick, so every "not now"
 * outcome here (busy, mode unknown) is safe: the next tick tries again.
 *
 * The decision uses the model's live mode, not `ChatQVAC`'s cached copy of
 * it: `getDelegationInfo()` re-reads the SDK registry on every call (a
 * local call, no network) and reloads the model if none is loaded, so a
 * model that changed mode outside a tracked switch is still corrected. An
 * unknown live mode (the introspection failed) changes nothing; the next
 * tick compares again. A chat that started while the mode was being read
 * also cancels the switch.
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
