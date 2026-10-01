export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ModelInfo = { name: string; quantization: string }
export type ModelStatusResponse = { status: ModelStatus; error?: string; model: ModelInfo }

export async function fetchModelStatus(): Promise<ModelStatusResponse> {
  const res = await fetch('/api/chat/status')
  if (!res.ok) throw new Error(`status check failed: ${res.status}`)
  return res.json()
}

export async function triggerPreload(): Promise<ModelStatusResponse> {
  const res = await fetch('/api/chat/preload', { method: 'POST' })
  if (!res.ok) throw new Error(`preload failed: ${res.status}`)
  return res.json()
}

export async function cancelPreload(): Promise<void> {
  const res = await fetch('/api/chat/preload/cancel', { method: 'POST' })
  if (!res.ok) throw new Error(`cancel preload failed: ${res.status}`)
}
