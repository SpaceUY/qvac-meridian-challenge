import { useRef } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ACCEPTED_FILE_INPUT_ACCEPT } from '@/lib/image-attachments'

type Props = {
  disabled?: boolean
  onFilesSelected: (files: File[]) => void
}

/** The discreet `+` at the bottom-left of the composer - same icon-button pattern as MicButton. Opens a hidden file input instead of a traditional upload widget. */
export function AttachButton({ disabled = false, onFilesSelected }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="shrink-0 rounded-full"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        aria-label="Attach image"
      >
        <Plus className="size-4" />
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_FILE_INPUT_ACCEPT}
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          // Reset so picking the exact same file again still fires onChange.
          e.target.value = ''
          if (files.length > 0) onFilesSelected(files)
        }}
      />
    </>
  )
}
