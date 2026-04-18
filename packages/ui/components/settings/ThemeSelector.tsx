"use client"

import { HugeiconsIcon } from "@hugeicons/react"
import {
  Sun01Icon,
  Moon01Icon,
  ComputerIcon,
} from "@hugeicons/core-free-icons"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"

const themeOptions = [
  {
    value: "light",
    label: "Light Theme",
    icon: Sun01Icon,
  },
  {
    value: "dark",
    label: "Dark Theme",
    icon: Moon01Icon,
  },
  {
    value: "system",
    label: "System Theme",
    icon: ComputerIcon,
  },
] as const

export function ThemeSelector() {
  const { resolvedTheme, setTheme, theme } = useTheme()
  const activeTheme = theme ?? resolvedTheme

  return (
    <div className="flex w-full items-center gap-2">
      {themeOptions.map((option) => {
        const isActive = activeTheme === option.value

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border py-4 transition-all",
              "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              isActive && "border-primary/50 bg-primary/5 text-primary shadow-sm ring-1 ring-primary/20"
            )}
          >
            <HugeiconsIcon
              icon={option.icon}
              size={24}
              strokeWidth={isActive ? 2 : 1.5}
            />
            <span className="text-[11px] font-medium uppercase tracking-wider">
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}



