// The corpus inventory, from GET /api/documents - the same list the
// list_documents tool gives the model (req. [3.1.1]), for the UI.

import { isObject } from '@/lib/utils'

export type CorpusDocument = {
  /** The document's path inside corpus/, e.g. "policies/warranty-terms.md". Unique. */
  id: string
  title: string
  /** Backend DocumentType ("POLICIES", "EMAIL", …). A string on purpose: a type added later must not break the parser. */
  type: string
  format: string
  /** Backend DocumentStatus ("ACTIVE", "ARCHIVED"). */
  status: string
  tags: string[]
  /** ISO 8601. */
  updatedAt: string
}

export async function fetchDocuments(): Promise<CorpusDocument[]> {
  const res = await fetch('/api/documents')
  if (!res.ok) throw new Error(`documents request failed: ${res.status}`)
  const body: unknown = await res.json()
  const documents = isObject(body) && Array.isArray(body.documents) ? body.documents : []
  // Keeps only well-formed entries (same policy as parseCitations).
  return documents
    .filter(isCorpusDocument)
    .map(({ id, title, type, format, status, tags, updatedAt }) => ({ id, title, type, format, status, tags, updatedAt }))
}

function isCorpusDocument(v: unknown): v is CorpusDocument {
  return (
    isObject(v) &&
    typeof v.id === 'string' &&
    typeof v.title === 'string' &&
    v.title !== '' &&
    typeof v.type === 'string' &&
    typeof v.format === 'string' &&
    typeof v.status === 'string' &&
    Array.isArray(v.tags) &&
    v.tags.every((tag) => typeof tag === 'string') &&
    typeof v.updatedAt === 'string'
  )
}
