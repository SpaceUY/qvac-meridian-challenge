import { useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { fetchModelStatus, triggerPreload, type ModelStatus, type ModelInfo } from '@/lib/model-status-client'

const STATUS_QUERY_KEY = ['model-status']
// How long we wait between checks while the model still isn't ready.
const POLL_MS = 1000

export function useModelStatus(): { status: ModelStatus; error?: string; model?: ModelInfo } {
  const query = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchModelStatus,
    // refetchInterval itself already retries every 1s - without this, the
    // library's 3 automatic retries (with backoff) collide with the next
    // refetchInterval and the 'error' state never gets a chance to settle.
    retry: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'ready' || status === 'error' ? false : POLL_MS
    },
  })

  const preload = useMutation({ mutationFn: triggerPreload })

  // Fires the preload exactly ONCE, as soon as we know it's 'idle'.
  // preload.status flips to 'pending' in the same render that calls
  // mutate(), so this effect can't fire it twice.
  useEffect(() => {
    if (query.data?.status === 'idle' && preload.status === 'idle') {
      preload.mutate()
    }
  }, [query.data?.status, preload])

  // The server can report 'error' (failed to load the model, already
  // covered by the spec), but it can also be unreachable altogether
  // (backend down) - there `query.data` never arrives, so that's handled
  // separately.
  if (query.isError) {
    return { status: 'error', error: 'could not reach the server' }
  }

  return { status: query.data?.status ?? 'idle', error: query.data?.error, model: query.data?.model }
}
