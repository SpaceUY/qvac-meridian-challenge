import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchModelStatus,
  triggerPreload,
  cancelPreload,
  type ModelStatus,
  type ModelInfo,
  type DelegationInfo,
} from '@/lib/model-status-client'

const STATUS_QUERY_KEY = ['model-status']
// How long we wait between checks while the model still isn't ready.
const POLL_MS = 1000
// Once ready, delegation status can still change mid-session (a delegated
// model falling back to local after its provider dies) - keep polling, just
// much less aggressively than while loading.
const READY_POLL_MS = 5000

export function useModelStatus(): {
  status: ModelStatus
  error?: string
  model?: ModelInfo
  delegation?: DelegationInfo
  /** Whether a delegation-recovery reload is in flight right now (see `AgentStatusPayload.recovering` on the backend). `false` until the first poll resolves. */
  recovering: boolean
  /** True once the user has cancelled a load and hasn't asked to retry yet - lets the UI say "cancelled" instead of "starting". */
  cancelled: boolean
  cancelLoad: () => void
  retryLoad: () => void
} {
  const queryClient = useQueryClient()
  const [cancelled, setCancelled] = useState(false)
  const query = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: fetchModelStatus,
    // refetchInterval itself already retries every 1s - without this, the
    // library's 3 automatic retries (with backoff) collide with the next
    // refetchInterval and the 'error' state never gets a chance to settle.
    retry: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (status === 'error') return false
      return status === 'ready' ? READY_POLL_MS : POLL_MS
    },
  })

  const preload = useMutation({ mutationFn: triggerPreload })

  // Fires the preload exactly ONCE, as soon as we know it's 'idle' - only
  // for the initial "just started" idle, never after a user-initiated
  // cancel (see cancelLoadMutation below), which is why `cancelled` is
  // part of the guard. preload.status flips to 'pending' in the same
  // render that calls mutate(), so this effect can't fire it twice.
  useEffect(() => {
    if (query.data?.status === 'idle' && preload.status === 'idle' && !cancelled) {
      preload.mutate()
    }
  }, [query.data?.status, preload, cancelled])

  const cancelLoadMutation = useMutation({
    mutationFn: cancelPreload,
    onSuccess: () => {
      // Stay cancelled - don't auto-retry. The user asked to stop, so the
      // load stays stopped until they explicitly call retryLoad() below.
      setCancelled(true)
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    },
  })

  function retryLoad() {
    setCancelled(false)
    preload.mutate()
  }

  // The server can report 'error' (failed to load the model, already
  // covered by the spec), but it can also be unreachable altogether
  // (backend down) - there `query.data` never arrives, so that's handled
  // separately.
  if (query.isError) {
    return {
      status: 'error',
      error: 'could not reach the server',
      recovering: false,
      cancelled,
      cancelLoad: () => cancelLoadMutation.mutate(),
      retryLoad,
    }
  }

  return {
    status: query.data?.status ?? 'idle',
    error: query.data?.error,
    model: query.data?.model,
    delegation: query.data?.delegation,
    recovering: query.data?.recovering ?? false,
    cancelled,
    cancelLoad: () => cancelLoadMutation.mutate(),
    retryLoad,
  }
}
