import { ChevronRight, FileText } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Markdown } from '@/components/markdown'
import { chunkLabel, citationTitle, formatChunk, formatScore } from '@/lib/citation-label'
import type { Citation, CitedChunk } from '@/lib/chat-types'

const CARD_CLASS = 'flex min-w-0 flex-col gap-1.5 rounded-lg border bg-card px-3.5 py-3'

/**
 * The human-readable side of req. [6.1.2]: every cited document as a card
 * under the answer - number, readable title, corpus path and similarity
 * score. Always visible (no hover needed): the sources are the proof that
 * the answer came from the corpus. Built only from `citations`, the same
 * array the API returns: the UI never has a second source of truth.
 *
 * `citedChunks` only adds a way in: a card whose file has passages opens
 * them in a dialog; one without (older reply, other server) stays a plain card.
 */
export function CitationSources({ citations, citedChunks }: { citations: Citation[]; citedChunks: CitedChunk[] }) {
  if (citations.length === 0) return null

  return (
    <section aria-label="Sources" className="mt-3 flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground">{citations.length === 1 ? '1 source' : `${citations.length} sources`}</p>
      <ol className="grid gap-2 sm:grid-cols-2">
        {citations.map((citation, index) => (
          <SourceCard
            key={citation.file}
            citation={citation}
            number={index + 1}
            chunks={citedChunks.filter((chunk) => chunk.file === citation.file)}
          />
        ))}
      </ol>
    </section>
  )
}

function SourceCard({ citation, number, chunks }: { citation: Citation; number: number; chunks: CitedChunk[] }) {
  if (chunks.length === 0) {
    return (
      <li className={CARD_CLASS}>
        <SourceCardContent citation={citation} number={number} />
      </li>
    )
  }

  return (
    <li className="min-w-0">
      <Dialog>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={`Show the cited passage from ${citationTitle(citation.file)}`}
            className={`${CARD_CLASS} w-full text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none`}
          >
            <SourceCardContent citation={citation} number={number} openable />
          </button>
        </DialogTrigger>
        <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{citationTitle(citation.file)}</DialogTitle>
            <DialogDescription className="font-mono text-xs break-all">{citation.file}</DialogDescription>
          </DialogHeader>
          <ul className="chat-scrollbar -mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
            {chunks.map((chunk, index) => (
              <li key={chunk.chunkIndex ?? index} className="rounded-lg border bg-card px-3.5 py-3">
                <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium">{chunkLabel(chunk)}</span>
                  <span className="font-mono tabular-nums" title="Retrieval similarity (higher is closer)">
                    {formatScore(chunk.score)}
                  </span>
                </div>
                <ChunkBody chunk={chunk} />
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </li>
  )
}

/** One passage, shown the way its file's format calls for - see `formatChunk` for why html is never rendered. */
function ChunkBody({ chunk }: { chunk: CitedChunk }) {
  const { kind, text } = formatChunk(chunk.file, chunk.content)

  if (kind === 'markdown') {
    return (
      <div className="text-sm leading-relaxed">
        <Markdown text={text} />
      </div>
    )
  }
  if (kind === 'code') {
    return <pre className="chat-scrollbar overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed">{text}</pre>
  }
  return <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
}

function SourceCardContent({ citation, number, openable = false }: { citation: Citation; number: number; openable?: boolean }) {
  return (
    <>
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
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={citation.file}>{citation.file}</p>
        {openable && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
      </div>
    </>
  )
}
