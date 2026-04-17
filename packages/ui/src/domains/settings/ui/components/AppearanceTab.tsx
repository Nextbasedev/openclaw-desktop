"use client"

import { useTheme } from "next-themes"
import { Separator } from "@/components/ui/separator"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { Sun03Icon, MoonIcon, ComputerSettingsIcon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

type ThemeOption = {
  id: "light" | "dark" | "system"
  label: string
  icon: typeof Sun03Icon
  description: string
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    id: "light",
    label: "Light",
    icon: Sun03Icon,
    description: "Light background with dark text",
  },
  {
    id: "dark",
    label: "Dark",
    icon: MoonIcon,
    description: "Dark background with light text",
  },
  {
    id: "system",
    label: "System",
    icon: ComputerSettingsIcon,
    description: "Follows your operating system preference",
  },
]

export function AppearanceTab() {
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize how OpenClaw Desktop looks on your device.
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
                  ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                  : "border-border/50 bg-transparent"
              )}
            >
              <div
                className={cn(
                  "flex size-10 items-center justify-center rounded-lg",
                  theme === option.id
                    ? "bg-primary/10 text-primary"
                    : "bg-muted/50 text-muted-foreground"
                )}
              >
                <HugeiconsIcon icon={option.icon} size={20} strokeWidth={1.5} />
              </div>
              <span
                className={cn(
                  "text-sm font-medium",
                  theme === option.id
                    ? "text-primary"
                    : "text-foreground"
                )}
              >
                {option.label}
              </span>
              <span className="text-xs text-muted-foreground text-center leading-tight">
                {option.description}
              </span>
            </button>
          ))}
        </div>
      </div>

      <Separator className="bg-border/50" />

      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">
          Interface Density
        </h3>
        <p className="text-sm text-muted-foreground mb-3">
          Choose how compact the interface feels.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="border-primary bg-primary/5 text-primary">
            Comfortable
          </Button>
          <Button variant="outline" size="sm">
            Compact
          </Button>
        </div>
      </div>

      <Separator className="bg-border/50" />

      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">
          Reduced Motion
        </h3>
        <p className="text-sm text-muted-foreground">
          Minimize animations throughout the interface for accessibility.
          Currently following system preferences.
        </p>
      </div>
    </div>
  )
}
