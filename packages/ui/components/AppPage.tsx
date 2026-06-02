"use client"

import { useMemo } from "react"

function routeLabel() {
  if (typeof window === "undefined") return "OpenClaw Desktop"
  const path = window.location.pathname
  if (path.startsWith("/settings")) return "Settings"
  if (path.startsWith("/notifications")) return "Notifications"
  if (path.startsWith("/connect")) return "Connect"
  if (path.startsWith("/skill")) return "Skills"
  return "OpenClaw Desktop"
}

export default function AppPage() {
  const label = useMemo(routeLabel, [])

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-6 text-foreground">
      <section className="max-w-xl rounded-3xl border border-border/50 bg-card/70 p-8 text-center shadow-2xl shadow-black/20">
        <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          {label}
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em]">
          Chat UI removed
        </h1>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">
          The old chat/sidebar frontend has been deleted on this branch. The next UI should be rebuilt cleanly from the middleware chat APIs.
        </p>
        <div className="mt-6 rounded-2xl border border-border/40 bg-background/60 p-4 text-left text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Middleware remains intact:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Chat bootstrap/messages/send APIs are still available.</li>
            <li>Frontend chat timeline/sidebar data callers are intentionally removed.</li>
            <li>This placeholder exists so the app can still build while the new UI is created.</li>
          </ul>
        </div>
      </section>
    </main>
  )
}
