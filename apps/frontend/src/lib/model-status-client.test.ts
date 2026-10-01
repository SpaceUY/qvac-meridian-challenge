import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchModelStatus } from '@/lib/model-status-client'

describe('fetchModelStatus', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses the hardware tier the backend resolved', async () => {
    const body = {
      status: 'ready',
      model: { name: 'fake', quantization: 'q4' },
      hardwareTier: 'medium',
      recovering: false,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))

    const result = await fetchModelStatus()

    expect(result.hardwareTier).toBe('medium')
  })

  it('rejects when the backend responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))

    await expect(fetchModelStatus()).rejects.toThrow('status check failed: 500')
  })
})
