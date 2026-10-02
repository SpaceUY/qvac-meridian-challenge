import { useState } from 'react'
import { DocumentContentLoader, FormattedContent } from '@/components/document-content'
import { chunkLabel, formatScore } from '@/lib/citation-label'
import type { CitedChunk } from '@/lib/chat-types'
import { highlightSegments } from '@/lib/document-highlight'

type View = 'passages' | 'document'

const VIEWS: { view: View; label: string }[] = [
  { view: 'passages', label: 'Passages' },
  { view: 'document', label: 'Full document' },
]

/**
 * What a source dialog shows under its title: the cited passages, or the
 * whole document with those passages highlighted. It opens on "Passages";
 * the document is only requested once the user switches to it.
 */
export function SourceDialogBody({ file, chunks }: { file: string; chunks: CitedChunk[] }) {
  const [view, setView] = useState<View>('passages')

  return (
    <>
      <div role="group" aria-label="View" className="inline-flex self-start rounded-lg border p-0.5 text-xs">
        {VIEWS.map((option) => (
          <button
            key={option.view}
            type="button"
            aria-pressed={view === option.view}
            onClick={() => setView(option.view)}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none ${
              view === option.view ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="chat-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {view === 'passages' ? <Passages chunks={chunks} /> : <FullDocument file={file} chunks={chunks} />}
      </div>
    </>
  )
}

function Passages({ chunks }: { chunks: CitedChunk[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {chunks.map((chunk, index) => (
        <li key={chunk.chunkIndex ?? index} className="rounded-lg border bg-card px-3.5 py-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="font-medium">{chunkLabel(chunk)}</span>
            <span className="font-mono tabular-nums" title="Retrieval similarity (higher is closer)">
              {formatScore(chunk.score)}
            </span>
          </div>
          <FormattedContent file={chunk.file} content={chunk.content} />
        </li>
      ))}
    </ul>
  )
}

/**
 * The document as source text, with the cited passages in green. Always the
 * raw source, whatever the format: a highlight is a character range in that
 * text, and rendering markdown would lose the mapping.
 */
function FullDocument({ file, chunks }: { file: string; chunks: CitedChunk[] }) {
  return (
    <DocumentContentLoader file={file}>{(content) => <HighlightedDocument content={content} chunks={chunks} />}</DocumentContentLoader>
  )
}

function HighlightedDocument({ content, chunks }: { content: string; chunks: CitedChunk[] }) {
  const { segments, missing } = highlightSegments(content, chunks)
  const firstHighlight = segments.findIndex((segment) => segment.highlighted)

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {missing === 0 ? (
          <>
            <mark className="rounded-sm bg-green-500/30 px-1 text-foreground">Green</mark> marks the cited passages.
          </>
        ) : missing === chunks.length ? (
          'The cited passages could not be found - this document changed since it was indexed.'
        ) : (
          `${missing} of ${chunks.length} cited passages could not be found - this document changed since it was indexed.`
        )}
      </p>
      <pre className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
        {segments.map((segment, index) =>
          segment.highlighted ? (
            <mark
              key={index}
              ref={index === firstHighlight ? scrollIntoViewOnMount : undefined}
              className="rounded-sm bg-green-500/30 text-foreground"
            >
              {segment.text}
            </mark>
          ) : (
            <span key={index}>{segment.text}</span>
          ),
        )}
      </pre>
    </div>
  )
}

/** Ref callback for the first highlight: brings it into view when the document appears. */
function scrollIntoViewOnMount(element: HTMLElement | null) {
  element?.scrollIntoView({ block: 'center' })
}
