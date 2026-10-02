// Turns the model's raw Markdown text into React elements — bold, lists,
// code, links — instead of one flat string. `remark-gfm` adds the GitHub
// flavor on top of base Markdown: tables, strikethrough, checklists.
//
// react-markdown never touches the DOM with raw HTML: it walks the parsed
// Markdown and renders each node as a real React element, picked from the
// `components` map below. That's what keeps this safe against whatever text
// the model happens to produce — there is no `dangerouslySetInnerHTML` here.

import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

const COMPONENTS: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline underline-offset-2">
      {children}
    </a>
  ),
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-md bg-muted p-2 text-xs last:mb-0">{children}</pre>
  ),
  // Tables: the parser emits bare <table> tags, which the browser draws with
  // no padding or borders. The wrapper div scrolls sideways when a table is
  // wider than the chat column instead of breaking the layout.
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto rounded-lg border border-border last:mb-0">
      <table className="w-full border-collapse text-sm tabular-nums">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
  // Every row gets a bottom line; the last body row drops it because the
  // wrapper's own border already closes the table.
  tbody: ({ children }) => <tbody className="[&>tr:last-child]:border-0">{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
  // `style` carries the `:---:` / `---:` alignment the model may write.
  th: ({ children, style }) => (
    <th
      style={style}
      className="whitespace-nowrap px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="px-3 py-2 align-top">
      {children}
    </td>
  ),
}

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTS}>
      {text}
    </ReactMarkdown>
  )
}
