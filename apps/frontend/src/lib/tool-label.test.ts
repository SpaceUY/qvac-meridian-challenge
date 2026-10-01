import { describe, expect, it } from 'vitest'
import { toolLabel } from '@/lib/tool-label'

describe('toolLabel', () => {
  it('labels lookup_stock as checking inventory', () => {
    expect(toolLabel('lookup_stock')).toEqual({
      label: 'Checked inventory',
      description: 'Looked up live stock and pricing data for this answer.',
    })
  })

  it('labels list_documents as reviewing documents', () => {
    expect(toolLabel('list_documents')).toEqual({
      label: 'Reviewed documents',
      description: 'Looked at the corpus inventory for this answer.',
    })
  })

  it('falls back to a title-cased version of an unknown tool name', () => {
    expect(toolLabel('check_weather')).toEqual({
      label: 'Check weather',
      description: 'Used the check_weather tool for this answer.',
    })
  })
})
