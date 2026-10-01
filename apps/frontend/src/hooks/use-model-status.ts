import { useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { fetchModelStatus, triggerPreload, type ModelStatus, type ModelInfo } from '@/lib/model-status-client'

const STATUS_QUERY_KEY = ['model-status']
// Cuánto esperamos entre preguntas mientras el modelo todavía no está listo.
const POLL_MS = 1000

export function useModelStatus(): { status: ModelStatus; error?: string; model?: ModelInfo } {
  const query = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchModelStatus,
    // El propio refetchInterval ya reintenta cada 1s — sin esto, los 3
    // reintentos automáticos de la librería (con backoff) se pisan con el
    // siguiente refetchInterval y el estado 'error' nunca llega a asentarse.
    retry: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'ready' || status === 'error' ? false : POLL_MS
    },
  })

  const preload = useMutation({ mutationFn: triggerPreload })

  // Dispara el preload UNA sola vez, apenas sabemos que está 'idle'.
  // preload.status pasa a 'pending' en el mismo render que se llama a
  // mutate(), así que no se puede disparar dos veces por este efecto.
  useEffect(() => {
    if (query.data?.status === 'idle' && preload.status === 'idle') {
      preload.mutate()
    }
  }, [query.data?.status, preload])

  // El servidor puede reportar 'error' (falló al cargar el modelo, spec ya
  // cubierta), pero también puede no ser alcanzable directamente (backend
  // apagado) — ahí `query.data` nunca llega, así que lo tratamos aparte.
  if (query.isError) {
    return { status: 'error', error: 'could not reach the server' }
  }

  return { status: query.data?.status ?? 'idle', error: query.data?.error, model: query.data?.model }
}
