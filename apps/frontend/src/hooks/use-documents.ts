import { useQuery } from '@tanstack/react-query'
import { fetchDocuments } from '@/lib/documents-client'

/** staleTime: Infinity - the corpus only changes on re-ingest, which requires a backend restart anyway. */
export function useDocuments() {
  return useQuery({ queryKey: ['documents'], queryFn: fetchDocuments, staleTime: Infinity })
}
