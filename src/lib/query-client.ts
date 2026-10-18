import { QueryClient } from '@tanstack/react-query'

// Data only refreshes on user action. Kept separate so non-React code can use it.
export const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } })
