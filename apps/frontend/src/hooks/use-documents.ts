import { useQuery } from '@tanstack/react-query'
import { fetchDocuments } from '@/lib/documents-client'

/**
 * The corpus inventory, fetched once and cached for the whole session
 * (staleTime: Infinity). The corpus only changes when someone re-runs the
 * ingest - and that means restarting the backend anyway.
 */
export function useDocuments() {
  return useQuery({ queryKey: ['documents'], queryFn: fetchDocuments, staleTime: Infinity })
}
