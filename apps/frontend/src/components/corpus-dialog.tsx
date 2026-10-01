import { useState } from 'react'
import { Search } from 'lucide-react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DocumentGrid, DocumentGridSkeleton } from '@/components/document-grid'
import { useDocuments } from '@/hooks/use-documents'
import type { CorpusDocument } from '@/lib/documents-client'

/** Left sidebar: "CORPUS · N docs", opening the full inventory in a modal. Req. [3.1.1]. The count only shows once it is real - never a placeholder number. */
export function CorpusDialog() {
  const documents = useDocuments()
  const [query, setQuery] = useState('')
  const count = documents.data?.length

  return (
    <Dialog onOpenChange={(isOpen) => { if (!isOpen) setQuery('') }}>
      <DialogTrigger asChild>
        <Button variant="ghost" className="w-full justify-between px-2">
          <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Corpus</span>
          {count !== undefined && <Badge variant="secondary">{count} docs</Badge>}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl">
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
        <div className="chat-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          <CorpusBody documents={documents} query={query} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CorpusBody({ documents, query }: { documents: UseQueryResult<CorpusDocument[]>; query: string }) {
  if (documents.isPending) return <DocumentGridSkeleton />
  if (documents.isError) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground">
        <p>Couldn't load the documents.</p>
        <Button size="sm" variant="outline" onClick={() => void documents.refetch()}>Retry</Button>
      </div>
    )
  }
  return <DocumentGrid documents={documents.data} query={query} />
}
