import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDocuments } from '@/lib/documents-client'

describe('fetchDocuments', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps status, tags, and updatedAt alongside the existing fields', async () => {
    const body = {
      documents: [
        {
          id: 'policies/warranty-terms.md',
          title: 'Warranty Terms',
          type: 'POLICIES',
          format: 'MARKDOWN',
          status: 'ACTIVE',
          tags: ['warranty', 'hardware'],
          updatedAt: '2026-01-15T00:00:00.000Z',
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))

    const documents = await fetchDocuments()

    expect(documents).toEqual([
      {
        id: 'policies/warranty-terms.md',
        title: 'Warranty Terms',
        type: 'POLICIES',
        format: 'MARKDOWN',
        status: 'ACTIVE',
        tags: ['warranty', 'hardware'],
        updatedAt: '2026-01-15T00:00:00.000Z',
      },
    ])
  })

  it('drops an entry missing status, tags, or updatedAt, same "well-formed only" policy as the other fields', async () => {
    const body = {
      documents: [
        { id: 'a.md', title: 'A', type: 'POLICIES', format: 'MARKDOWN', status: 'ACTIVE', tags: [], updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'b.md', title: 'B', type: 'POLICIES', format: 'MARKDOWN', status: 'ACTIVE', tags: [] }, // missing updatedAt
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))

    const documents = await fetchDocuments()

    expect(documents).toHaveLength(1)
    expect(documents[0].id).toBe('a.md')
  })
})
