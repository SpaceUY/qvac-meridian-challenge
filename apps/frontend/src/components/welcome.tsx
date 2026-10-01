import { LoaderCircle } from 'lucide-react'
import type { ModelStatus } from '@/lib/model-status-client'

type Props = { modelStatus: ModelStatus; modelCancelled: boolean }

/** The empty conversation: a greeting in the middle of the chat, plus why the composer is still disabled while the model isn't ready. */
export function Welcome({ modelStatus, modelCancelled }: Props) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-2xl font-medium">How may I help you?</h1>
      {/* Fixed height: when the hint disappears, the title must not jump. */}
      <div className="h-5">
        <ModelHint modelStatus={modelStatus} modelCancelled={modelCancelled} />
      </div>
    </div>
  )
}

function ModelHint({ modelStatus, modelCancelled }: Props) {
  if (modelStatus === 'ready') return null
  if (modelStatus === 'error') return <p className="text-sm text-destructive">The model failed to load.</p>
  // A cancelled load is reported as 'idle' by the server - `modelCancelled` tells it apart from the startup idle.
  if (modelCancelled) return <p className="text-sm text-muted-foreground">Model load cancelled.</p>
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle className="size-4 animate-spin" />
      Preparing the model…
    </p>
  )
}
