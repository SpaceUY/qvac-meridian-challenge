import { SquarePen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useChatStore } from '@/lib/chat-store'

/** Top of the left sidebar. Asks first, then wipes the conversation - see conversationReset. Disabled while there is nothing to wipe. */
export function NewChatButton() {
  const isEmpty = useChatStore((state) => state.history.length === 0)

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-2 px-2" disabled={isEmpty}>
          <SquarePen className="size-4" />
          New chat
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>Start a new chat?</AlertDialogTitle>
        <AlertDialogDescription>The current conversation will be lost.</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={handleConfirm}>New chat</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function handleConfirm() {
  useChatStore.getState().conversationReset()
}
