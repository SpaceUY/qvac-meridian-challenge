import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import type { DelegationInfo, ModelInfo, ModelStatus } from '@/lib/model-status-client'

type Props = {
  model?: ModelInfo
  modelStatus: ModelStatus
  statusError?: string
  delegation?: DelegationInfo
  cancelled: boolean
  onCancelLoad: () => void
  onRetryLoad: () => void
}

const STATUS_LABEL: Record<ModelStatus, string> = {
  idle: 'Starting…',
  loading: 'Loading model…',
  ready: 'Running locally',
  error: 'Load failed',
}
const STATUS_COLOR: Record<ModelStatus, string> = {
  idle: 'text-muted-foreground',
  loading: 'text-amber-500',
  ready: 'text-emerald-500',
  error: 'text-destructive',
}

/** Truncated the same way the backend's own provider.ts log lines do (first 16 hex chars + "…"), so this matches what a developer sees in the terminal. */
function formatProviderKey(providerPublicKey: string): string {
  return `${providerPublicKey.slice(0, 16)}…`
}

/** Right panel: "with what" the assistant runs. Req. [5.1] + [5.1.1]. */
export function EnginePanel({ model, modelStatus, statusError, delegation, cancelled, onCancelLoad, onRetryLoad }: Props) {
  // A cancelled load is still reported as 'idle' by the server (it's not a
  // failure) - `cancelled` is what tells that apart from the app's initial
  // "about to auto-start" idle, so the label/action match what happened.
  const showCancelledState = modelStatus === 'idle' && cancelled
  // 'ready' has two sub-labels depending on where the model actually ran -
  // not delegated (or delegation status unknown) still reads "Running
  // locally", which is correct: a configured delegate that fell back to
  // local is genuinely running locally now, not a bug.
  const isRunningRemotely = modelStatus === 'ready' && delegation?.isDelegated === true
  const label = showCancelledState
    ? 'Load cancelled'
    : isRunningRemotely
      ? 'Running on remote peer'
      : STATUS_LABEL[modelStatus]
  const subtitle =
    modelStatus === 'error'
      ? statusError
      : isRunningRemotely && delegation?.providerPublicKey
        ? `Provider: ${formatProviderKey(delegation.providerPublicKey)}`
        : 'No peers available.'

  return (
    <div className="flex flex-col gap-4 text-sm">
      <Section title="Inference">
        <div className="flex items-center justify-between gap-1.5">
          <div className={`flex items-center gap-1.5 font-medium ${STATUS_COLOR[modelStatus]}`}>
            <span className="size-1.5 rounded-full bg-current" />
            {label}
          </div>
          {modelStatus === 'loading' && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onCancelLoad}>
              Cancel
            </Button>
          )}
          {showCancelledState && (
            <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onRetryLoad}>
              Load
            </Button>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </Section>

      <Separator />
      <Section title="Chat model">
        <Kv label="Name" value={model?.name ?? '—'} />
        <Kv label="Quantization" value={model?.quantization ?? '—'} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  )
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b py-1 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}
