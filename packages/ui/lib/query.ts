"use client"

import { QueryClient } from "@tanstack/react-query"

export const queryKeys = {
  sessions: () => ["sessions"] as const,
  chatBootstrap: (sessionKey: string) => ["chat-bootstrap", sessionKey] as const,
}

export const queryStaleTime = {
  sessions: 2_000,
  chatBootstrap: 5_000,
}

export function createOpenClawQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 2_000,
        gcTime: 5 * 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  })
}
