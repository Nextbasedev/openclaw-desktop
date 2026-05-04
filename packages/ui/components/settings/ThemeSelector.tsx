"use client"

import { Icons } from "@/components/icons"
import { useTheme } from "next-themes"

import { cn } from "@/lib/utils"

const themeOptions = [
  {
    value: "light",
    label: "Light Theme",
    Icon: Icons.Sun,
  },
  {
    value: "dark",
    label: "Dark Theme",
    Icon: Icons.Moon,
  },
  {
    value: "system",
    label: "System Theme",
    Icon: Icons.System,
  },
] as const

export function ThemeSelector() {
  const { resolvedTheme, setTheme, theme } = useTheme()
  const activeTheme = theme ?? resolvedTheme

  return (
    <div className="flex w-full items-center gap-2">
      {themeOptions.map((option) => {
        const isActive = activeTheme === option.value
        const Icon = option.Icon

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={cn(
              "cursor-pointer flex flex-1 flex-col items-center justify-center gap-4 rounded-md border py-6 transition-all",
              "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              isActive && "border-primary/50 bg-primary/5 text-primary shadow-sm ring-1 ring-primary/20"
            )}
          >
            <Icon
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




