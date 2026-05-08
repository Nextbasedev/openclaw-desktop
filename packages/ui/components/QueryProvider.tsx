"use client"

import * as React from "react"
import { QueryClientProvider } from "@tanstack/react-query"
import { createOpenClawQueryClient } from "@/lib/query"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = React.useState(() => createOpenClawQueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
