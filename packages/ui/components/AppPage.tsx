"use client"

import { ChatApp } from "@/components/chat/ui/ChatApp"

/**
 * Root route. Renders the v5 chat shell (session sidebar + active timeline),
 * rebuilt from the middleware chat APIs.
 * Set NEXT_PUBLIC_CHAT_V5=0 to fall back to the removed-UI placeholder.
 */
export default function AppPage() {
  if (process.env.NEXT_PUBLIC_CHAT_V5 === "0") return <RemovedPlaceholder />

  return (
    <main className="h-screen w-screen overflow-hidden bg-background text-foreground">
      <ChatApp />
    </main>
  )
}

function RemovedPlaceholder() {
  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-6 text-foreground">
      <section className="max-w-xl rounded-3xl border border-border/50 bg-card/70 p-8 text-center shadow-2xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">OCPlatform Desktop</p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">Chat UI removed</h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The old chat/sidebar frontend was deleted on this branch. Set NEXT_PUBLIC_CHAT_V5 to re-enable the new chat.
        </p>
      </section>
    </main>
  )
}
