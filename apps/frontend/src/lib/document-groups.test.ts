import { describe, expect, it } from 'vitest'
import { formatUpdatedAt } from '@/lib/document-groups'

describe('formatUpdatedAt', () => {
  it('formats an ISO date as a short, locale-independent date', () => {
    expect(formatUpdatedAt('2026-01-15T00:00:00.000Z')).toBe('Jan 15, 2026')
  })
})
