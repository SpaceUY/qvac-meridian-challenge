import { Dialog } from 'radix-ui'
import { X } from 'lucide-react'

type Props = {
  src: string | null
  onClose: () => void
}

/** Bigger view of an attached/sent image, shared by the composer's pending thumbnails and MessageList's sent images. Built on radix-ui's Dialog (already a dependency, via react-dialog) instead of a new one - focus trap, Escape-to-close and aria wiring come for free. */
export function ImageLightbox({ src, onClose }: Props) {
  return (
    <Dialog.Root open={src !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Image preview</Dialog.Title>
          {src && (
            <img src={src} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-lg" />
          )}
          <Dialog.Close
            className="absolute -top-3 -right-3 flex size-8 items-center justify-center rounded-full bg-background text-foreground shadow-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            aria-label="Close preview"
          >
            <X className="size-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
