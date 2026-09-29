import type { ReactNode } from 'react'
import { Separator } from '@/components/ui/separator'
import type { FAKE_ENGINE_STATE } from '@/lib/fake-data'

type EngineState = typeof FAKE_ENGINE_STATE
type Props = { state: EngineState }

/** Right panel: "with what" the assistant runs. Req. [5.1] + [5.1.1] + [5.2]. */
export function EnginePanel({ state }: Props) {
  const ramPercent = Math.round((state.usedRamGb / state.availableRamGb) * 100)

  return (
    <div className="flex flex-col gap-4 text-sm">
      <Section title="Inference">
        <div className="flex items-center gap-1.5 font-medium text-emerald-500">
          <span className="size-1.5 rounded-full bg-current" />
          {state.mode === 'local' ? 'Running locally' : 'Delegated to a peer'}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {state.mode === 'local' ? 'No peers available.' : 'Falls back to local if the peer drops.'}
        </p>
      </Section>

      <Separator />
      <Section title="Chat model">
        <Kv label="Name" value={state.model.name} />
        <Kv label="Quantization" value={state.model.quantization} />
        <Kv label="Context" value={`${state.model.context} tok`} />
        <Kv label="Speed" value={`${state.model.tokensPerSec} tok/s`} />
      </Section>

      <Separator />
      <Section title="This machine">
        <Kv label="CPU" value={state.machine.cpu} />
        <Kv label="RAM" value={`${state.machine.totalRamGb} GB`} />
        <p className="mt-2 text-xs text-muted-foreground">RAM used by the model</p>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${ramPercent}%` }} />
        </div>
      </Section>

      <Separator />
      <Section title="Selected profile">
        <p className="text-xs text-muted-foreground">{state.selectedProfile}</p>
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
