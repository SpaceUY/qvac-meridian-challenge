import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import type { ModelInfo, ModelStatus } from '@/lib/model-status-client'

type Props = { model?: ModelInfo; modelStatus: ModelStatus; statusError?: string }

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

/** Right panel: "with what" the assistant runs. Req. [5.1] + [5.1.1]. */
export function EnginePanel({ model, modelStatus, statusError }: Props) {
  return (
    <div className="flex flex-col gap-4 text-sm">
      <Section title="Inference">
        <div className={`flex items-center gap-1.5 font-medium ${STATUS_COLOR[modelStatus]}`}>
          <span className="size-1.5 rounded-full bg-current" />
          {STATUS_LABEL[modelStatus]}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {modelStatus === 'error' ? statusError : 'No peers available.'}
        </p>
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
