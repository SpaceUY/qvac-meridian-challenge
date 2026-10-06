import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelPreload, fetchModelStatus, triggerPreload } from '@/lib/model-status-client'

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

  it('parses the per-tier STT/TTS model names and embedding readiness', async () => {
    const body = {
      status: 'ready',
      model: { name: 'fake', quantization: 'q4' },
      hardwareTier: 'medium',
      recovering: false,
      sttModel: 'Whisper Small Q8_0',
      ttsModel: 'Supertonic3 Q4_0',
      embeddingReady: true,
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))

    const result = await fetchModelStatus()

    expect(result.sttModel).toBe('Whisper Small Q8_0')
    expect(result.ttsModel).toBe('Supertonic3 Q4_0')
    expect(result.embeddingReady).toBe(true)
  })

  it('parses providerHealth when a delegate is configured', async () => {
    const body = {
      status: 'ready',
      model: { name: 'fake', quantization: 'q4' },
      hardwareTier: 'medium',
      recovering: false,
      sttModel: 'Whisper Small Q8_0',
      ttsModel: 'Supertonic3 Q4_0',
      embeddingReady: true,
      providerHealth: { state: 'up', consecutiveFailures: 0, lastSuccessAt: '2026-09-30T12:00:00.000Z', lastLatencyMs: 42 },
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))))

    const result = await fetchModelStatus()

    expect(result.providerHealth).toEqual({
      state: 'up',
      consecutiveFailures: 0,
      lastSuccessAt: '2026-09-30T12:00:00.000Z',
      lastLatencyMs: 42,
    })
  })
})

describe('triggerPreload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts to the preload endpoint and returns the resulting status', async () => {
    const body = { status: 'loading', model: { name: 'fake', quantization: 'q4' }, hardwareTier: 'medium', recovering: false }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body)))
    vi.stubGlobal('fetch', fetchMock)

    const result = await triggerPreload()

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/preload', { method: 'POST' })
    expect(result.status).toBe('loading')
  })

  it('rejects when the backend responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))

    await expect(triggerPreload()).rejects.toThrow('preload failed: 500')
  })
})

describe('cancelPreload', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts to the cancel endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await cancelPreload()

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/preload/cancel', { method: 'POST' })
  })

  it('rejects when the backend responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 500 })))

    await expect(cancelPreload()).rejects.toThrow('cancel preload failed: 500')
  })
})
