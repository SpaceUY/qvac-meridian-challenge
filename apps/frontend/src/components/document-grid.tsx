import type { ReactNode } from 'react'
import { FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatLabel, formatUpdatedAt, groupDocuments } from '@/lib/document-groups'
import type { CorpusDocument } from '@/lib/documents-client'

type Props = { documents: CorpusDocument[]; query: string; onSelect: (doc: CorpusDocument) => void }

/** The corpus modal's body: one section per document type, cards inside. Pure presentation - the grouping rules live in document-groups.ts. A card is a button: picking one is the parent's call (`onSelect`). */
export function DocumentGrid({ documents, query, onSelect }: Props) {
  if (documents.length === 0) return <EmptyMessage>The corpus is empty.</EmptyMessage>

  const groups = groupDocuments(documents, query)
  if (groups.length === 0) return <EmptyMessage>No documents match “{query.trim()}”.</EmptyMessage>

  return (
    <div className="flex flex-col gap-5 pb-1">
      {groups.map((group) => (
        <section key={group.type} aria-label={group.label}>
          <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.label} · {group.documents.length}
          </h3>
          <ul className="grid gap-2 sm:grid-cols-2">
            {group.documents.map((doc) => (
              <DocumentCard key={doc.id} doc={doc} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function DocumentCard({ doc, onSelect }: { doc: CorpusDocument; onSelect: (doc: CorpusDocument) => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(doc)}
        className="flex w-full items-start gap-3 rounded-lg border bg-secondary/30 p-3 text-left transition-colors hover:bg-secondary/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={doc.title}>{doc.title}</p>
          <p className="truncate text-xs text-muted-foreground" title={doc.id}>{doc.id}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            Updated {formatUpdatedAt(doc.updatedAt)}
            {doc.tags.length > 0 ? ` · ${doc.tags.join(', ')}` : ''}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant="outline">{formatLabel(doc.format)}</Badge>
          {doc.status === 'ARCHIVED' && (
            <Badge variant="secondary" title="No longer the current version - kept for reference only">
              Archived
            </Badge>
          )}
        </div>
      </button>
    </li>
  )
}

/** Six grey cards that pulse while the inventory is on its way. */
export function DocumentGridSkeleton() {
  return (
    <div className="grid gap-2 sm:grid-cols-2" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
    </div>
  )
}

function EmptyMessage({ children }: { children: ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>
}
