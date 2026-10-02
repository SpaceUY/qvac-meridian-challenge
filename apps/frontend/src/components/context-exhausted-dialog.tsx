import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useChatStore } from '@/lib/chat-store'

/**
 * Shown once, when the backend reports this conversation's context window
 * full. It only informs: OK (or Escape) closes it, and the composer stays
 * disabled until New chat - see chat-store's contextExhausted.
 */
export function ContextExhaustedDialog() {
  const open = useChatStore((state) => state.contextNoticeOpen)

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && dismiss()}>
      <AlertDialogContent>
        <AlertDialogTitle>This conversation has reached its limit</AlertDialogTitle>
        <AlertDialogDescription>
          To keep its answers accurate, the assistant can only work with so much of a conversation at once, and this
          one is now full. Everything above stays here for you to read. Start a new chat to keep asking questions.
        </AlertDialogDescription>
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
