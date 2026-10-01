import { describe, expect, it } from 'vitest'
import { citationTitle, formatScore } from '@/lib/citation-label'

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
