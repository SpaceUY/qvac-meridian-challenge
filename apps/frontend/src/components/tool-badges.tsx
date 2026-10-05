import { Wrench } from 'lucide-react'
import { toolLabel } from '@/lib/tool-label'

/** One chip per tool used, above the source cards - e.g. "Checked inventory" shows the answer used live data, not just the model. Squarer+wrench so they don't read as sources; `title` carries the long description as a tooltip (same convention as document-grid.tsx's `doc.id`). */
export function ToolBadges({ tools }: { tools: string[] }) {
  if (tools.length === 0) return null

  return (
    <ul aria-label="Tools used" className="mt-3 flex flex-wrap items-center gap-1.5">
      {tools.map((tool) => {
        const { label, description } = toolLabel(tool)
        return (
          <li
            key={tool}
            title={description}
            className="inline-flex items-center gap-1.5 rounded-md border bg-secondary px-2 py-1 text-xs text-muted-foreground"
          >
            <Wrench className="size-3 shrink-0" aria-hidden />
            {label}
          </li>
        )
      })}
    </ul>
  )
}
