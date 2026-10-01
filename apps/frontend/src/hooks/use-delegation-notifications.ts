import { useEffect, useRef } from 'react'
import { classifyDelegationTransition, type DelegationSnapshot } from '@/lib/peers'
import { messageFor, type NotificationSeverity } from '@/lib/peer-notification-copy'
import { notifySuccess, notifyWarning, notifyError } from '@/lib/notifier'

const SEVERITY_NOTIFIERS: Record<NotificationSeverity, (message: string) => void> = {
  success: notifySuccess,
  warning: notifyWarning,
  error: notifyError,
}

/** Watches the polled delegation snapshot and fires the matching toast whenever it transitions (connect, recovery starting, recovery resolving) - never on every poll, only on an actual change. Call once, at the top of the app, with the latest snapshot from `useModelStatus()`. */
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
