import { useQuery } from '@tanstack/react-query'
import { fetchDocumentContent } from '@/lib/documents-client'

/**
 * One whole document, cached for the session (same reasoning as
 * useDocuments: the corpus only changes with a backend restart). It is
 * fetched when the component using it mounts - the source dialog mounts its
 * "Full document" view only once the user asks for it, so nothing is
 * downloaded for a dialog that stays on "Passages".
 */
export function useDocumentContent(file: string) {
  return useQuery({
    queryKey: ['document-content', file],
    queryFn: () => fetchDocumentContent(file),
    staleTime: Infinity,
  })
}
