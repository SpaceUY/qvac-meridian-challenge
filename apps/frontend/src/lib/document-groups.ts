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

/** Groups by type in KNOWN_GROUPS order, sorts each group by title; a type the backend adds later falls under "Other". */
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

/** "2026-01-15T00:00:00.000Z" -> "Jan 15, 2026". Fixed en-US/UTC on purpose, not the viewer's locale/timezone. */
export function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
