// apps/frontend/src/components/mic-button.tsx
import { LoaderCircle, Mic } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { VoicePhase } from '@/hooks/use-voice-turn'

type Props = {
  phase: VoicePhase
  disabled?: boolean
  onClick: () => void
}

/** Starts a voice recording (or retries after an error). While recording, `Composer` doesn't render this button - `RecordingBar` replaces it, with its own cancel/send controls. The error message for `phase.type === 'error'` is rendered by `Composer`, not here - it needs the full row width, not this button's own flex column. */
export function MicButton({ phase, disabled = false, onClick }: Props) {
  const isProcessing = phase.type === 'processing'

  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className="shrink-0 rounded-full transition-transform active:scale-[0.98]"
      disabled={disabled || isProcessing}
      onClick={onClick}
      aria-label="Record audio"
    >
      {isProcessing ? <LoaderCircle className="size-4 animate-spin" /> : <Mic className="size-4" />}
    </Button>
  )
}
