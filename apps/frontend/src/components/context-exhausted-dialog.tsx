import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useChatStore } from '@/lib/chat-store'

/** Informational only; the composer stays disabled until New chat regardless (see chat-store's contextExhausted). */
export function ContextExhaustedDialog() {
  const open = useChatStore((state) => state.contextNoticeOpen)

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <AlertDialogContent>
        <AlertDialogTitle>This conversation has reached its limit</AlertDialogTitle>
        <AlertDialogDescription>To keep answers accurate, please start a new chat</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogAction onClick={dismiss}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function dismiss() {
  useChatStore.getState().contextNoticeDismissed()
}
