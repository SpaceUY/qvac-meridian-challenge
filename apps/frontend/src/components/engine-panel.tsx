import type { ReactNode } from 'react'
import { LoaderCircle, Users } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { SidebarSection } from '@/components/sidebar-section'
import { describeEngineStatus, type EngineTone } from '@/lib/engine-status'
import { describePeers, describeProviderHealth } from '@/lib/peers'
import type { DelegationInfo, ModelInfo, ModelStatus, ProviderHealth, ResourceTier } from '@/lib/model-status-client'

type Props = {
  model?: ModelInfo
  modelStatus: ModelStatus
  statusError?: string
  serverUnreachable: boolean
  hardwareTier?: ResourceTier
  sttModel?: string
  ttsModel?: string
  delegation?: DelegationInfo
  providerHealth?: ProviderHealth
  recovering: boolean
  cancelled: boolean
  onCancelLoad: () => void
  onRetryLoad: () => void
}

const TONE_TEXT: Record<EngineTone, string> = {
  ready: 'text-primary',
  working: 'text-amber-400',
  idle: 'text-muted-foreground',
  error: 'text-destructive',
}
const TONE_DOT: Record<Exclude<EngineTone, 'working'>, string> = {
  ready: 'bg-primary ring-3 ring-primary/20',
  idle: 'bg-muted-foreground',
  error: 'bg-destructive ring-3 ring-destructive/20',
}
const HARDWARE_TIER_LABEL: Record<ResourceTier, string> = { low: 'Low', medium: 'Medium', high: 'High' }

/** "With what" the assistant runs: status card, active models, peers. Req. [5.1] + [5.1.1]. What each state says is decided in lib/engine-status.ts and lib/peers.ts - this file only draws it. */
export function EnginePanel(props: Props) {
  const { modelStatus, statusError, serverUnreachable, hardwareTier, delegation, providerHealth, recovering, cancelled } = props
  const view = describeEngineStatus({ status: modelStatus, cancelled, serverUnreachable, recovering, statusError, delegation })
  const peers = describePeers(delegation)

  return (
    <div className="flex flex-col gap-6">
      <SidebarSection title="Inference">
        <div className={cn('flex flex-col gap-3 rounded-xl border bg-card p-3.5', view.tone === 'error' && 'border-destructive/30')}>
          <div className="flex items-center gap-2">
            {view.tone === 'working' ? (
              <LoaderCircle className="size-3.5 animate-spin text-amber-400" aria-hidden />
            ) : (
              <span aria-hidden className={cn('size-2 shrink-0 rounded-full', TONE_DOT[view.tone])} />
            )}
            <span role="status" className={cn('flex-1 text-sm font-semibold', TONE_TEXT[view.tone])}>{view.label}</span>
            {view.location && <Chip>{view.location}</Chip>}
            {view.action === 'cancel' && <Button size="xs" variant="ghost" onClick={props.onCancelLoad}>Cancel</Button>}
            {view.action === 'load' && <Button size="xs" variant="ghost" onClick={props.onRetryLoad}>Load</Button>}
          </div>
          {view.detail && <p className="text-xs leading-relaxed break-all text-muted-foreground">{view.detail}</p>}
          {hardwareTier && !serverUnreachable && (
            <div className="flex flex-wrap gap-1.5"><Chip>{HARDWARE_TIER_LABEL[hardwareTier]} tier</Chip></div>
          )}
        </div>
      </SidebarSection>

      {/* While the server is down, whatever model info is left over is stale - show none of it. */}
      {!serverUnreachable && <ActiveModels model={props.model} sttModel={props.sttModel} ttsModel={props.ttsModel} />}

      <SidebarSection title="Peers">
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-3.5">
          <div className="flex items-center gap-2.5">
            <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm">{peers.title}</span>
              <span className="truncate text-xs text-muted-foreground">{peers.detail}</span>
            </div>
            <Chip>{peers.count}</Chip>
          </div>
          {providerHealth && <ProviderHealthLine health={providerHealth} />}
        </div>
      </SidebarSection>
    </div>
  )
}

/** Chat/VLM, STT and TTS (PR #48). Rows without data are left out instead of showing "—". */
function ActiveModels({ model, sttModel, ttsModel }: Pick<Props, 'model' | 'sttModel' | 'ttsModel'>) {
  if (!model && !sttModel && !ttsModel) return null
  return (
    <SidebarSection title="Active models">
      <dl className="flex flex-col gap-2.5 rounded-xl border bg-card p-3.5">
        {model && <ModelRow kind="Chat / VLM" name={model.name} extra={model.quantization} />}
        {sttModel && <ModelRow kind="Speech-to-text" name={sttModel} />}
        {ttsModel && <ModelRow kind="Text-to-speech" name={ttsModel} />}
      </dl>
    </SidebarSection>
  )
}

function ModelRow({ kind, name, extra }: { kind: string; name: string; extra?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{kind}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-1.5">
        {/* break-all: ids like QWEN3_5_9B_MULTIMODAL_Q4_K_M have no spaces to wrap on. */}
        <span className="min-w-0 font-mono text-xs font-medium break-all">{name}</span>
        {extra && <Chip>{extra}</Chip>}
      </dd>
    </div>
  )
}

/** Heartbeat of the delegate (PR #48): short label on screen, detail in the native tooltip. */
function ProviderHealthLine({ health }: { health: ProviderHealth }) {
  const view = describeProviderHealth(health)
  return (
    <p title={view.tooltip} className={cn('flex items-center gap-1.5 text-xs', view.up ? 'text-primary' : 'text-destructive')}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {view.label}
    </p>
  )
}

/** Small monospace tag for technical values (Q4_K_M, on-device, a count). */
function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="shrink-0 rounded-md border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">{children}</span>
  )
}
