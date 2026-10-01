import { toast } from 'sonner'

/** Thin wrapper over Sonner - the only file that imports it. Knows nothing about peers or delegation; just shows a toast of the given severity. */
export function notifySuccess(message: string): void {
  toast.success(message)
}

export function notifyWarning(message: string): void {
  toast.warning(message)
}

export function notifyError(message: string): void {
  toast.error(message)
}
