import { useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, Database, Search } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { CorpusDocumentView } from '@/components/corpus-document-view'
import { DocumentGrid, DocumentGridSkeleton } from '@/components/document-grid'
import { useDocuments } from '@/hooks/use-documents'
import type { CorpusDocument } from '@/lib/documents-client'

/**
 * Left sidebar: the "Corpus · N docs" card, opening the full inventory in a modal. Req. [3.1.1]. The count only shows once it is real - never a placeholder number.
 * Picking a document swaps the modal to that document (one dialog, not a stack); Back returns to the list with the search text and scroll position as they were.
 */
export function CorpusDialog() {
  const documents = useDocuments()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<CorpusDocument | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listScrollTop = useRef(0)
  const count = documents.data?.length

  // The list unmounts while a document is open, so its scroll position is
  // kept here and put back as soon as the list is on screen again.
  useLayoutEffect(() => {
    if (selected === null && listRef.current) listRef.current.scrollTop = listScrollTop.current
  }, [selected])

  const openDocument = (doc: CorpusDocument) => {
    listScrollTop.current = listRef.current?.scrollTop ?? 0
    setSelected(doc)
  }

  return (
    <Dialog
      onOpenChange={(isOpen) => {
        if (isOpen) return
        setQuery('')
        setSelected(null)
        listScrollTop.current = 0
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Database className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 font-medium">Corpus</span>
          {count !== undefined && <span className="font-mono text-xs text-muted-foreground">{count} docs</span>}
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
        {selected ? (
          <CorpusDocumentView doc={selected} onBack={() => setSelected(null)} />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Corpus</DialogTitle>
              <DialogDescription>
                {count !== undefined ? `${count} documents the assistant can search and cite` : 'The documents the assistant can search and cite'}
              </DialogDescription>
            </DialogHeader>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search documents…"
                aria-label="Search documents"
                className="pl-8"
              />
            </div>
            <div ref={listRef} className="chat-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <CorpusBody documents={documents} query={query} onSelect={openDocument} />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CorpusBody({
  documents,
  query,
  onSelect,
}: {
  documents: UseQueryResult<CorpusDocument[]>
  query: string
  onSelect: (doc: CorpusDocument) => void
}) {
  if (documents.isPending) return <DocumentGridSkeleton />
  if (documents.isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
        <p>Couldn't load the documents.</p>
        <Button size="sm" variant="outline" onClick={() => void documents.refetch()}>Retry</Button>
      </div>
    )
  }
  return <DocumentGrid documents={documents.data} query={query} onSelect={onSelect} />
}
