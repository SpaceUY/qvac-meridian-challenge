import type { DelegationInfo } from '@/lib/model-status-client'

/** A comparable snapshot of delegation state at one point in time - what `classifyDelegationTransition` diffs against the previous one. */
export type DelegationSnapshot = { isDelegated: boolean; recovering: boolean }

/** The one thing that changed between two consecutive `DelegationSnapshot`s, or `null` if nothing did. */
export type DelegationEvent = 'connected' | 'recovering-started' | 'reconnected' | 'fell-back-to-local'

/** How many peers are available to delegate inference to right now. Today the backend only supports one configured peer, so this is always 0 or 1 - kept as a count (not a boolean) so the badge doesn't need to change the day the backend supports more than one. */
export function countAvailablePeers(delegation: DelegationInfo | undefined): number {
  return delegation?.isDelegated ? 1 : 0
}

/**
 * Compares two `DelegationSnapshot`s and says which single transition (if
 * any) just happened. `previous` is `undefined` on the very first snapshot
 * (nothing to compare against yet) - this deliberately reports `null`
 * rather than `'connected'` in that case, so reloading the page while
 * already delegated doesn't fire a false "just connected" notification.
 */
export function classifyDelegationTransition(
  previous: DelegationSnapshot | undefined,
  current: DelegationSnapshot,
): DelegationEvent | null {
  if (!previous) return null
  if (!previous.isDelegated && current.isDelegated && !current.recovering) return 'connected'
  if (!previous.recovering && current.recovering) return 'recovering-started'
  if (previous.recovering && !current.recovering) {
    return current.isDelegated ? 'reconnected' : 'fell-back-to-local'
  }
  return null
}
