import { describe, expect, it } from 'vitest'
import { chunkLabel, citationTitle, formatChunk, formatScore } from '@/lib/citation-label'

describe('citationTitle', () => {
  it('turns a corpus path into a readable document name', () => {
    expect(citationTitle('reports/q2-2026-sales-performance-report.md')).toBe('Q2 2026 Sales Performance Report')
  })

  it('handles underscores, nested folders and root-level files', () => {
    expect(citationTitle('emails/2026/deal_update_acme.txt')).toBe('Deal Update Acme')
    expect(citationTitle('warranty-terms.md')).toBe('Warranty Terms')
  })

  it('falls back to the raw path when there is no name to show', () => {
    expect(citationTitle('.md')).toBe('.md')
  })
})

describe('formatScore', () => {
  it('shows two decimals, never a percentage', () => {
    expect(formatScore(0.8312)).toBe('0.83')
    expect(formatScore(1)).toBe('1.00')
  })
})

describe('chunkLabel', () => {
  it('numbers a passage from 1, since chunkIndex is zero-based', () => {
    expect(chunkLabel({ chunkIndex: 0 })).toBe('Passage 1')
    expect(chunkLabel({ chunkIndex: 3 })).toBe('Passage 4')
  })

  it('drops the number when the chunk has no index', () => {
    expect(chunkLabel({})).toBe('Passage')
  })
})

describe('formatChunk', () => {
  it('keeps markdown files as markdown, whatever the extension case', () => {
    expect(formatChunk('reports/q2.md', '## Revenue')).toEqual({ kind: 'markdown', text: '## Revenue' })
    expect(formatChunk('reports/Q2.MD', '## Revenue')).toEqual({ kind: 'markdown', text: '## Revenue' })
  })

  it('pretty-prints a chunk that is a complete JSON document', () => {
    expect(formatChunk('data/stock.json', '{"sku":"SD-X4-001","qty":12}')).toEqual({
      kind: 'code',
      text: '{\n  "sku": "SD-X4-001",\n  "qty": 12\n}',
    })
  })

  it('shows a JSON fragment as it is, since a chunk usually cuts through the middle of the structure', () => {
    const fragment = '"qty": 12 },\n{ "sku": "SD-X4-002", "qty"'
    expect(formatChunk('data/stock.json', fragment)).toEqual({ kind: 'code', text: fragment })
  })

  it('shows html and csv as source text, never as markdown or markup', () => {
    const html = '<h1>Q2</h1><script>alert(1)</script>'
    expect(formatChunk('reports/q2.html', html)).toEqual({ kind: 'code', text: html })
    expect(formatChunk('data/sales.csv', 'region,revenue\nEMEA,6.1')).toEqual({ kind: 'code', text: 'region,revenue\nEMEA,6.1' })
  })

  it('keeps plain text as text, for .txt and for a file with no usable extension', () => {
    expect(formatChunk('emails/update.txt', 'Hi team,\nQ2 closed.')).toEqual({ kind: 'text', text: 'Hi team,\nQ2 closed.' })
    expect(formatChunk('notes/v1.2/README', 'plain')).toEqual({ kind: 'text', text: 'plain' })
  })
})
