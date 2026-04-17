"use client"

import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

type ThemeOption = {
  id: string
  label: string
  description: string
}

const THEME_OPTIONS: ThemeOption[] = [
  { id: "light", label: "Light", description: "Light background" },
  { id: "dark", label: "Dark", description: "Dark background" },
  { id: "system", label: "System", description: "Follows OS preference" },
]

export function AppearanceTab() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize how OpenClaw Desktop looks.
        </p>
      </div>

      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Theme</h3>
        <div className="grid grid-cols-3 gap-3">
          {THEME_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setTheme(option.id)}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border p-4 transition-all",
                "hover:bg-muted/50",
                theme === option.id
                  ? "border-accent bg-accent/10"
                  : "border-border/50"
              )}
            >
              <span
                className={cn(
                  "text-sm font-medium",
                  theme === option.id ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground text-center">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
