import type { CorpusDocument } from '@/lib/documents-client'

export type DocumentGroup = { type: string; label: string; documents: CorpusDocument[] }

/** Display order and label per backend DocumentType - most authoritative first. */
const KNOWN_GROUPS = [
  { type: 'POLICIES', label: 'Policies' },
  { type: 'REPORTS', label: 'Reports' },
  { type: 'DATA', label: 'Data' },
  { type: 'FAQ', label: 'FAQs' },
  { type: 'TRANSCRIPT', label: 'Transcripts' },
  { type: 'EMAIL', label: 'Emails' },
]
const KNOWN_TYPES = new Set(KNOWN_GROUPS.map((group) => group.type))

/**
 * Filters by title or path (case-insensitive), groups by type in
 * KNOWN_GROUPS order, sorts each group by title, and drops empty groups.
 * A type the backend adds later still shows up, under "Other" at the end.
 */
export function groupDocuments(documents: CorpusDocument[], query: string): DocumentGroup[] {
  const needle = query.trim().toLowerCase()
  const matching = needle
    ? documents.filter((doc) => doc.title.toLowerCase().includes(needle) || doc.id.toLowerCase().includes(needle))
    : documents

  const groups: DocumentGroup[] = [
    ...KNOWN_GROUPS.map((group) => ({ ...group, documents: matching.filter((doc) => doc.type === group.type) })),
    { type: 'OTHER', label: 'Other', documents: matching.filter((doc) => !KNOWN_TYPES.has(doc.type)) },
  ]
  return groups
    .filter((group) => group.documents.length > 0)
    .map((group) => ({ ...group, documents: [...group.documents].sort((a, b) => a.title.localeCompare(b.title)) }))
}

const FORMAT_LABEL: Record<string, string> = { MARKDOWN: 'MD', CSV: 'CSV', JSON: 'JSON', HTML: 'HTML', TEXT: 'TXT' }

/** "MARKDOWN" → "MD". An unknown format is shown as-is rather than hidden. */
export function formatLabel(format: string): string {
  return FORMAT_LABEL[format] ?? format
}
