import type { ReactNode } from 'react'
import { Markdown } from '@/components/markdown'
import { useDocumentContent } from '@/hooks/use-document-content'
import { formatChunk } from '@/lib/citation-label'

/** Text shown the way its file's format calls for - see `formatChunk` for why html is never rendered. Used for one passage and for a whole document alike. */
export function FormattedContent({ file, content }: { file: string; content: string }) {
  const { kind, text } = formatChunk(file, content)

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

/** Fetches one whole document and hands its text to `children`, with the loading and failure messages every document view shares. */
export function DocumentContentLoader({ file, children }: { file: string; children: (content: string) => ReactNode }) {
  const document = useDocumentContent(file)

  if (document.isPending) return <p className="py-6 text-center text-sm text-muted-foreground">Loading document…</p>
  if (document.isError) return <p className="py-6 text-center text-sm text-muted-foreground">Couldn't load the document.</p>
  return <>{children(document.data.content)}</>
}
