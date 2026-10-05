import { FileText } from 'lucide-react'
import { citationTitle, formatScore } from '@/lib/citation-label'
import type { Citation } from '@/lib/chat-types'

/** Req. [6.1.2]. Always visible, not hover-only: sources are the proof the answer came from the corpus. */
export function CitationSources({ citations }: { citations: Citation[] }) {
  if (citations.length === 0) return null

  return (
    <section aria-label="Sources" className="mt-3 flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{citations.length === 1 ? '1 source' : `${citations.length} sources`}</p>
      <ol className="grid gap-2 sm:grid-cols-2">
        {citations.map((citation, index) => (
          <SourceCard key={citation.file} citation={citation} number={index + 1} />
        ))}
      </ol>
    </section>
  )
}

function SourceCard({ citation, number }: { citation: Citation; number: number }) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card px-3.5 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-[18px] shrink-0 items-center justify-center rounded-[5px] bg-primary/15 font-mono text-[11px] text-primary">
          {number}
        </span>
        <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate text-sm font-medium">{citationTitle(citation.file)}</span>
        {citation.score !== undefined && (
          <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted-foreground" title="Retrieval similarity (higher is closer)">
            {formatScore(citation.score)}
          </span>
        )}
      </div>
      <p className="truncate font-mono text-xs text-muted-foreground" title={citation.file}>{citation.file}</p>
    </li>
  )
}
