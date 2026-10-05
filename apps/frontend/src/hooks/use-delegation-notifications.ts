import { useEffect, useRef } from 'react'
import { classifyDelegationTransition, type DelegationSnapshot } from '@/lib/peers'
import { messageFor, type NotificationSeverity } from '@/lib/peer-notification-copy'
import { notifySuccess, notifyWarning, notifyError } from '@/lib/notifier'

const SEVERITY_NOTIFIERS: Record<NotificationSeverity, (message: string) => void> = {
  success: notifySuccess,
  warning: notifyWarning,
  error: notifyError,
}

/** Fires a toast only when the delegation state actually transitions, not on every poll. Call once, with the latest `useModelStatus()` snapshot. */
export function useDelegationNotifications(snapshot: DelegationSnapshot): void {
  const previousRef = useRef<DelegationSnapshot | undefined>(undefined)

  useEffect(() => {
    const event = classifyDelegationTransition(previousRef.current, snapshot)
    if (event) {
      const { severity, message } = messageFor(event)
      SEVERITY_NOTIFIERS[severity](message)
    }
    previousRef.current = snapshot
  }, [snapshot.isDelegated, snapshot.recovering])
}
