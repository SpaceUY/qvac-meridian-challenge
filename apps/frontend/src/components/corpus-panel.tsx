import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { FileText } from 'lucide-react'
import type { CorpusDocument } from '@/lib/fake-data'

type Props = { documents: CorpusDocument[] }

/** Left panel: "what does" the assistant know. Req. [3.1.1] (list_documents). */
export function CorpusPanel({ documents }: Props) {
  const totalChunks = documents.reduce((sum, d) => sum + d.chunks, 0)

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Corpus</span>
        <Badge variant="secondary">{documents.length} docs</Badge>
      </div>

      <ScrollArea className="flex-1">
        <ul className="flex flex-col gap-1">
          {documents.map((doc) => (
            <li
              key={doc.file}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
            >
              <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{doc.file}</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">{doc.chunks}</span>
            </li>
          ))}
        </ul>
      </ScrollArea>

      <Separator />
      <p className="px-1 text-xs text-muted-foreground">{totalChunks} chunks indexed · LanceDB local</p>
    </div>
  )
}
