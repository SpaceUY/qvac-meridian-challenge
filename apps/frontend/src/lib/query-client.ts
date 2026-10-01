import { QueryClient } from '@tanstack/react-query'

/** One instance for the whole app — every useQuery/useMutation shares this cache. */
export const queryClient = new QueryClient()
