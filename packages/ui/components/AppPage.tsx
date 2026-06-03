"use client"

import { useEffect, useState } from "react"
import ConnectPage from "@/components/ConnectPage"
import { ChatApp } from "@/components/chat/ui/ChatApp"
import {
  getMiddlewareConnection,
  testMiddlewareConnection,
  MIDDLEWARE_CONNECTION_CHANGED_EVENT,
  MIDDLEWARE_DISCONNECTED_EVENT,
} from "@/lib/middleware-client"

/**
 * Root route. Shows the connect page until the middleware is reachable, then the
 * v5 chat shell (sidebar + timeline). Set NEXT_PUBLIC_CHAT_V5=0 to disable the chat.
 */
export default function AppPage() {
  const [connected, setConnected] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    const evaluate = async () => {
      const conn = getMiddlewareConnection()
      if (!conn) { if (!cancelled) setConnected(false); return }
      try {
        const health = await testMiddlewareConnection(conn)
        if (!cancelled) setConnected(health?.ok === true)
      } catch {
        if (!cancelled) setConnected(false)
      }
    }
    void evaluate()
    const onChange = () => void evaluate()
    window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, onChange)
    window.addEventListener(MIDDLEWARE_DISCONNECTED_EVENT, onChange)
    return () => {
      cancelled = true
      window.removeEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, onChange)
      window.removeEventListener(MIDDLEWARE_DISCONNECTED_EVENT, onChange)
    }
  }, [])

  if (connected === null) {
    return (
      <main className="flex h-screen w-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Connecting…
      </main>
    )
  }
  if (!connected) return <ConnectPage />
  if (process.env.NEXT_PUBLIC_CHAT_V5 === "0") {
    return (
      <main className="flex min-h-screen w-full items-center justify-center bg-background px-6 text-foreground">
        <p className="text-sm text-muted-foreground">Chat v5 disabled (NEXT_PUBLIC_CHAT_V5=0).</p>
      </main>
    )
  }

  return (
    <main className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <ChatApp />
    </main>
  )
}
