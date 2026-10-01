import { CircleAlert, LoaderCircle } from 'lucide-react'
import { BrandMark } from '@/components/brand-mark'
import { useDocuments } from '@/hooks/use-documents'
import type { ModelStatus } from '@/lib/model-status-client'

type Props = {
  modelStatus: ModelStatus
  modelCancelled: boolean
  /** The RAG knowledge base (embeddings) is loaded - without it answers would have no sources. */
  embeddingReady: boolean
  serverUnreachable: boolean
  /** Sends a starter question as if the user had typed it. */
  onAsk: (text: string) => void
}

/** One per corpus area, each answerable from a real document (named on the right) - so the first click already shows grounded answers with sources. */
const STARTER_QUESTIONS = [
  { area: 'Policies', text: 'What’s the first-response SLA for a P1 ticket?' }, // policies/escalation-matrix.txt
  { area: 'Reports', text: 'Summarize Q2 2026 sales performance' }, // reports/q2-2026-sales-performance-report.md
  { area: 'Policies', text: 'What do the warranty terms cover?' }, // policies/warranty-terms.md
  { area: 'Policies', text: 'How does field service work offline?' }, // policies/field-service-offline-sop.md
]

/** The empty conversation: what the assistant can do, and why it can't yet when the model or the server isn't ready. */
export function Welcome({ modelStatus, modelCancelled, embeddingReady, serverUnreachable, onAsk }: Props) {
  if (serverUnreachable) return <ServerUnreachable />
  // Starter questions are about the corpus: they wait for the knowledge base too, not just the model.
  const ready = modelStatus === 'ready' && embeddingReady

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7 px-4 py-10 text-center">
      <BrandMark className="size-12 rounded-xl" />
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Ask your documents anything</h1>
        {/* Fixed height: when the hint changes, the title must not jump. */}
        <div className="h-5">
          <ModelHint modelStatus={modelStatus} modelCancelled={modelCancelled} embeddingReady={embeddingReady} />
        </div>
      </div>
      <ul className="grid w-full max-w-2xl gap-2.5 sm:grid-cols-2">
        {STARTER_QUESTIONS.map((question) => (
          <li key={question.text}>
            <button
              type="button"
              disabled={!ready}
              onClick={() => onAsk(question.text)}
              className="flex h-full w-full flex-col items-start gap-1.5 rounded-xl border bg-card px-4 py-3.5 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="text-[11px] font-semibold tracking-wider text-primary uppercase">{question.area}</span>
              <span className="text-sm">{question.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ModelHint({ modelStatus, modelCancelled, embeddingReady }: Pick<Props, 'modelStatus' | 'modelCancelled' | 'embeddingReady'>) {
  const count = useDocuments().data?.length
  if (modelStatus === 'ready' && !embeddingReady) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Preparing knowledge base…
      </p>
    )
  }
  if (modelStatus === 'ready') {
    return <p className="text-sm text-muted-foreground">{count !== undefined ? `${count} documents searchable on this device` : 'Your documents, searched on this device'}</p>
  }
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

/** The backend itself is down (not the model). Says what to run - the person looking at a local app is the one who started it. No retry button: polling reconnects by itself. */
function ServerUnreachable() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-start gap-4 rounded-2xl border bg-card p-7">
        <span className="flex size-11 items-center justify-center rounded-xl bg-destructive/15 text-destructive">
          <CircleAlert className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Can’t connect to the local server</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Meridian runs entirely on this device, so it needs the API server running. Start it from the repo root:
          </p>
        </div>
        <code className="w-full rounded-lg border bg-background px-3 py-2.5 font-mono text-sm">
          <span className="text-muted-foreground select-none">$ </span>npm run dev:server
        </code>
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden />
          Reconnecting automatically — no need to reload the page.
        </p>
      </div>
    </div>
  )
}
