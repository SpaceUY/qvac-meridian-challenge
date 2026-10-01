import { FileText } from 'lucide-react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { citationTitle, formatScore } from '@/lib/citation-label'
import type { Citation } from '@/lib/chat-types'

/**
 * The human-readable side of req. [6.1.2]: one pill under the answer naming
 * the top source ("Q2 2026 Sales Performance Report +1"). Hovering it - or
 * reaching it with Tab - opens a card listing every cited document with its
 * corpus path and similarity score. Built only from `citations`, the same
 * array the API returns: the UI never has a second source of truth.
 */
export function CitationSources({ citations }: { citations: Citation[] }) {
  const [top, ...rest] = citations
  if (!top) return null

  return (
    <HoverCard openDelay={150} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <FileText className="size-3 shrink-0" aria-hidden />
          <span className="truncate">{citationTitle(top.file)}</span>
          {rest.length > 0 && <span className="shrink-0 font-medium">+{rest.length}</span>}
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-80">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {citations.length === 1 ? 'Source' : `${citations.length} sources`}
        </p>
        <ul className="flex flex-col gap-2">
          {citations.map((citation) => (
            <CitationRow key={citation.file} citation={citation} />
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  )
}

function CitationRow({ citation }: { citation: Citation }) {
  return (
    <li className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{citationTitle(citation.file)}</p>
        <p className="truncate font-mono text-xs text-muted-foreground" title={citation.file}>
          {citation.file}
        </p>
      </div>
      {citation.score !== undefined && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground" title="Retrieval similarity (higher is closer)">
          {formatScore(citation.score)}
        </span>
      )}
    </li>
  )
}
