// The API sends only a tool's machine name (e.g. "lookup_stock") - this turns it into the badge label + hover description.

type ToolCopy = { label: string; description: string }

const KNOWN_TOOLS: Record<string, ToolCopy> = {
  lookup_stock: {
    label: 'Checked inventory',
    description: 'Looked up live stock and pricing data for this answer.',
  },
  list_documents: {
    label: 'Reviewed documents',
    description: 'Looked at the corpus inventory for this answer.',
  },
}

/** "check_weather" -> "Check weather" - used only as a fallback for a tool this file doesn't know about yet, so a new tool never breaks the badge row, it just reads a bit more literally. */
function titleCaseFromSnakeCase(name: string): string {
  const [first, ...rest] = name.split('_')
  if (!first) return name
  return [first[0].toUpperCase() + first.slice(1), ...rest].join(' ')
}

export function toolLabel(name: string): ToolCopy {
  return (
    KNOWN_TOOLS[name] ?? {
      label: titleCaseFromSnakeCase(name),
      description: `Used the ${name} tool for this answer.`,
    }
  )
}
