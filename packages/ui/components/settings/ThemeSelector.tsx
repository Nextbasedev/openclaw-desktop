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
    <div className="flex w-full items-center gap-2 max-sm:flex-col">
      {themeOptions.map((option) => {
        const isActive = activeTheme === option.value
        const Icon = option.Icon

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={cn(
              "flex flex-1 cursor-pointer flex-col items-center justify-center gap-4 rounded-md py-6 transition-all max-sm:w-full max-sm:flex-row max-sm:justify-start max-sm:px-4 max-sm:py-4",
              "bg-black/[0.025] dark:bg-white/[0.025] text-muted-foreground hover:bg-black/[0.045] hover:text-foreground dark:hover:bg-white/[0.045]",
              isActive && "bg-black/[0.055] dark:bg-white/[0.075] text-foreground"
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



