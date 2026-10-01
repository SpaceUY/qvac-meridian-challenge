import type { DelegationEvent } from '@/lib/peers'

/** Which Sonner toast variant a notification should use. */
export type NotificationSeverity = 'success' | 'warning' | 'error'

/** Translates a delegation-state transition into the toast text and severity to show for it. Knows nothing about Sonner or React - just a lookup table. */
export function messageFor(event: DelegationEvent): { severity: NotificationSeverity; message: string } {
  switch (event) {
    case 'connected':
      return { severity: 'success', message: 'Connected to a peer — inference running remotely' }
    case 'recovering-started':
      return { severity: 'warning', message: 'Peer down — trying to reconnect…' }
    case 'reconnected':
      return { severity: 'success', message: 'Reconnected to peer' }
    case 'fell-back-to-local':
      return { severity: 'error', message: "Couldn't reconnect — now running locally" }
  }
}
