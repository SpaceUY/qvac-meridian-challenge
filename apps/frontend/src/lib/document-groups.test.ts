import { describe, expect, it } from 'vitest'
import { formatLabel, formatUpdatedAt, groupDocuments } from '@/lib/document-groups'
import type { CorpusDocument } from '@/lib/documents-client'

function doc(overrides: Partial<CorpusDocument> & Pick<CorpusDocument, 'id' | 'title' | 'type'>): CorpusDocument {
  return { format: 'MARKDOWN', status: 'ACTIVE', tags: [], updatedAt: '2026-01-01T00:00:00.000Z', ...overrides }
}

describe('groupDocuments', () => {
  it('orders known groups by KNOWN_GROUPS and sorts documents within a group by title', () => {
    const documents = [
      doc({ id: 'r1', title: 'Q3 Report', type: 'REPORTS' }),
      doc({ id: 'p2', title: 'Warranty Terms', type: 'POLICIES' }),
      doc({ id: 'p1', title: 'Return Policy', type: 'POLICIES' }),
    ]

    const groups = groupDocuments(documents, '')

    expect(groups.map((g) => g.type)).toEqual(['POLICIES', 'REPORTS'])
    expect(groups[0].documents.map((d) => d.id)).toEqual(['p1', 'p2'])
  })

  it('puts a type the backend has not listed under "Other"', () => {
    const documents = [doc({ id: 'x1', title: 'Spec Sheet', type: 'SPEC' })]

    const groups = groupDocuments(documents, '')

    expect(groups).toEqual([{ type: 'OTHER', label: 'Other', documents: [documents[0]] }])
  })

  it('omits groups with no matching documents', () => {
    const documents = [doc({ id: 'f1', title: 'Pricing FAQ', type: 'FAQ' })]

    const groups = groupDocuments(documents, '')

    expect(groups).toHaveLength(1)
    expect(groups[0].type).toBe('FAQ')
  })

  it('filters by title or id, case-insensitively', () => {
    const documents = [
      doc({ id: 'policies/warranty.md', title: 'Warranty Terms', type: 'POLICIES' }),
      doc({ id: 'policies/returns.md', title: 'Return Policy', type: 'POLICIES' }),
    ]

    expect(groupDocuments(documents, 'WARRANTY')[0].documents).toEqual([documents[0]])
    expect(groupDocuments(documents, 'returns.md')[0].documents).toEqual([documents[1]])
    expect(groupDocuments(documents, 'nothing matches this')).toEqual([])
  })
})

describe('formatLabel', () => {
  it('maps a known format to its short label', () => {
    expect(formatLabel('MARKDOWN')).toBe('MD')
    expect(formatLabel('CSV')).toBe('CSV')
  })

  it('shows an unknown format as-is instead of hiding it', () => {
    expect(formatLabel('PDF')).toBe('PDF')
  })
})

describe('formatUpdatedAt', () => {
  it('formats an ISO date as a short, locale-independent date', () => {
    expect(formatUpdatedAt('2026-01-15T00:00:00.000Z')).toBe('Jan 15, 2026')
  })
})
