import { ChevronLeft } from 'lucide-react'
import { DocumentContentLoader, FormattedContent } from '@/components/document-content'
import { Button } from '@/components/ui/button'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CorpusDocument } from '@/lib/documents-client'

/** The corpus dialog's second screen: one document, shown by its format, with a way back to the list. */
export function CorpusDocumentView({ doc, onBack }: { doc: CorpusDocument; onBack: () => void }) {
  return (
    <>
      <DialogHeader>
        <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 self-start text-muted-foreground">
          <ChevronLeft aria-hidden />
          Corpus
        </Button>
        <DialogTitle>{doc.title}</DialogTitle>
        <DialogDescription className="font-mono text-xs break-all">{doc.id}</DialogDescription>
      </DialogHeader>
      <div className="chat-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        <DocumentContentLoader file={doc.id}>{(content) => <FormattedContent file={doc.id} content={content} />}</DocumentContentLoader>
      </div>
    </>
  )
}
