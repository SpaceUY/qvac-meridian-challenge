import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchModelStatus,
  triggerPreload,
  cancelPreload,
  type ModelStatus,
  type ModelInfo,
  type DelegationInfo,
  type ResourceTier,
  type ProviderHealth,
} from '@/lib/model-status-client'

const STATUS_QUERY_KEY = ['model-status']
const POLL_MS = 1000
// Slower poll once ready: delegation can still change mid-session (provider dies -> local fallback).
const READY_POLL_MS = 5000

export function useModelStatus(): {
  status: ModelStatus
  error?: string
  /** The status request itself failed (backend down) - as opposed to the backend reporting that the model failed to load. Polling keeps going, so this clears by itself once the server is back. */
  serverUnreachable: boolean
  model?: ModelInfo
  hardwareTier?: ResourceTier
  delegation?: DelegationInfo
  /** Whether a delegation-recovery reload is in flight right now (see `AgentStatusPayload.recovering` on the backend). `false` until the first poll resolves. */
  recovering: boolean
  providerHealth?: ProviderHealth
  sttModel?: string
  ttsModel?: string
  embeddingReady: boolean
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
    // refetchInterval already retries every 1s; the library's own retry/backoff would collide with it.
    retry: false,
    refetchInterval: (q) => {
      const status = q.state.data?.status
      if (status === 'error') return false
      return status === 'ready' ? READY_POLL_MS : POLL_MS
    },
  })

  const preload = useMutation({ mutationFn: triggerPreload })

  // Fires preload once for the initial idle only - `cancelled` excludes a user-cancelled idle from retriggering it.
  useEffect(() => {
    if (query.data?.status === 'idle' && preload.status === 'idle' && !cancelled) {
      preload.mutate()
    }
  }, [query.data?.status, preload, cancelled])

  const cancelLoadMutation = useMutation({
    mutationFn: cancelPreload,
    onSuccess: () => {
      // Stays stopped until the user explicitly calls retryLoad().
      setCancelled(true)
      void queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
    },
  })

  function retryLoad() {
    setCancelled(false)
    preload.mutate()
  }

  // Server-reported 'error' is covered by query.data below; an unreachable backend never gets data at all.
  if (query.isError) {
    return {
      status: 'error',
      error: 'could not reach the server',
      serverUnreachable: true,
      recovering: false,
      embeddingReady: false,
      cancelled,
      cancelLoad: () => cancelLoadMutation.mutate(),
      retryLoad,
    }
  }

  return {
    status: query.data?.status ?? 'idle',
    error: query.data?.error,
    serverUnreachable: false,
    model: query.data?.model,
    hardwareTier: query.data?.hardwareTier,
    delegation: query.data?.delegation,
    recovering: query.data?.recovering ?? false,
    providerHealth: query.data?.providerHealth,
    sttModel: query.data?.sttModel,
    ttsModel: query.data?.ttsModel,
    embeddingReady: query.data?.embeddingReady ?? false,
    cancelled,
    cancelLoad: () => cancelLoadMutation.mutate(),
    retryLoad,
  }
}
