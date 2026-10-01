import type { DelegationInfo, ModelStatus } from '@/lib/model-status-client'

/** Which of the four looks the engine card takes: color of the dot and label. */
export type EngineTone = 'ready' | 'working' | 'idle' | 'error'

export type EngineStatusInput = {
  status: ModelStatus
  /** The user cancelled the load - the server still reports that as plain 'idle'. */
  cancelled: boolean
  /** The status request itself failed: the backend is down, not the model. */
  serverUnreachable: boolean
  /** A delegation-recovery reload is in flight (the backend's `recovering`). */
  recovering: boolean
  statusError?: string
  delegation?: DelegationInfo
}

export type EngineStatusView = {
  tone: EngineTone
  label: string
  /** Second line under the label; absent when there is nothing worth adding. */
  detail?: string
  /** Where inference runs - only known once the model is ready. */
  location?: 'on-device' | 'remote peer'
  /** The one button the card offers, if any. */
  action?: 'cancel' | 'load'
}

/** Truncated the same way the backend's provider.ts log lines do (first 16 hex chars + "…"), so this matches what a developer sees in the terminal. */
export function formatProviderKey(providerPublicKey: string): string {
  return `${providerPublicKey.slice(0, 16)}…`
}

/**
 * Everything the engine card shows, decided in one place. Order matters:
 * - an unreachable server also reports status 'error', so it goes first;
 * - a cancelled load wins over `recovering`, and `recovering` wins over
 *   loading/ready - the same precedence the PR #48 label chain had.
 */
export function describeEngineStatus({ status, cancelled, serverUnreachable, recovering, statusError, delegation }: EngineStatusInput): EngineStatusView {
  // No retry button: useModelStatus keeps polling while the request fails, so the app reconnects by itself.
  if (serverUnreachable) return { tone: 'error', label: 'Server unreachable', detail: 'Reconnecting automatically…' }
  if (status === 'error') return { tone: 'error', label: 'Load failed', detail: statusError }
  if (status === 'idle' && cancelled) return { tone: 'idle', label: 'Load cancelled', action: 'load' }
  if (recovering) {
    // A recovery is itself a model reload: while it is loading, it can still be cancelled.
    return status === 'loading' ? { tone: 'working', label: 'Reconnecting…', action: 'cancel' } : { tone: 'working', label: 'Reconnecting…' }
  }
  if (status === 'loading') return { tone: 'working', label: 'Loading model…', action: 'cancel' }
  if (status === 'idle') return { tone: 'working', label: 'Starting…' }
  if (delegation?.isDelegated) {
    const detail = delegation.providerPublicKey ? `Provider: ${formatProviderKey(delegation.providerPublicKey)}` : undefined
    return detail
      ? { tone: 'ready', label: 'Running on remote peer', location: 'remote peer', detail }
      : { tone: 'ready', label: 'Running on remote peer', location: 'remote peer' }
  }
  return { tone: 'ready', label: 'Running locally', location: 'on-device' }
}
