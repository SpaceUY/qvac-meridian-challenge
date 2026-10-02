import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDocumentContent, fetchDocuments } from '@/lib/documents-client'

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

describe('fetchDocumentContent', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('asks for the file by its encoded corpus path and returns the whole document', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: 'data/stock levels.json', format: 'JSON', content: '{"qty":12}' })))
    vi.stubGlobal('fetch', fetchMock)

    const document = await fetchDocumentContent('data/stock levels.json')

    expect(fetchMock).toHaveBeenCalledWith('/api/documents/content?file=data%2Fstock%20levels.json')
    expect(document).toEqual({ id: 'data/stock levels.json', format: 'JSON', content: '{"qty":12}' })
  })

  it('throws when the server does not have the document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Document not found' }), { status: 404 })))

    await expect(fetchDocumentContent('gone.md')).rejects.toThrow('404')
  })

  it('throws on a body without text content instead of showing an empty document', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'a.md', format: 'MARKDOWN' }))))

    await expect(fetchDocumentContent('a.md')).rejects.toThrow()
  })
})
