"use client"

import { ThemeSelector } from "@/components/settings/ThemeSelector"

export function AppearanceTab() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize how OpenClaw Desktop looks.
        </p>
      </div>

      <div>
        <h3 className="text-sm mb-3">Theme</h3>
        <ThemeSelector />
      </div>
    </div>
  )
}
