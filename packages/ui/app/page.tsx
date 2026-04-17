"use client"

import { Header } from "@/src/domains/shell/ui/components/Header"
import { SettingsModal } from "@/src/domains/settings/ui/components/SettingsModal"

export default function Page() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <Header />
      <SettingsModal />

      {/* Main content area — placeholder for chat/dashboard */}
      <main className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
            <span className="text-2xl font-bold text-primary">OC</span>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground">
              OpenClaw Desktop
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Neural Operations Center — Ready
            </p>
          </div>
          <p className="text-xs text-muted-foreground/60">
            Click the ⚙️ icon in the header to open Settings
          </p>
        </div>
      </main>
    </div>
  )
}
