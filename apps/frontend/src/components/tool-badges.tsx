import { Wrench } from 'lucide-react'
import { toolLabel } from '@/lib/tool-label'

/**
 * One chip per tool the agent used for this reply, in a row of its own above
 * the source cards: seeing "Checked inventory" tells the user the answer used
 * live data, not only the model. Squarer than the old pills and with a wrench,
 * so they don't read as sources. `title` carries the longer description as a
 * native tooltip, same convention document-grid.tsx uses for `doc.id`.
 */
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
