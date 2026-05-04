"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"

import { ThemeSelector } from "@/components/settings/ThemeSelector"

const colorTokens = [
  {
    label: "Primary",
    token: "--primary",
    usage: "Buttons, active states",
  },
  {
    label: "Background",
    token: "--background",
    usage: "Main app canvas",
  },
  {
    label: "Foreground",
    token: "--foreground",
    usage: "Primary text and icons",
  },
  {
    label: "Card",
    token: "--card",
    usage: "Panels and surfaces",
  },
  {
    label: "Muted",
    token: "--muted",
    usage: "Secondary surfaces",
  },
  {
    label: "Border",
    token: "--border",
    usage: "Dividers and outlines",
  },
]

export function AppearanceTab() {
  const { resolvedTheme } = useTheme()
  const [tokenValues, setTokenValues] = useState<Record<string, string>>({})

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const styles = getComputedStyle(document.documentElement)
      setTokenValues(
        Object.fromEntries(
          colorTokens.map((item) => [
            item.token,
            styles.getPropertyValue(item.token).trim(),
          ]),
        ),
      )
    })

    return () => cancelAnimationFrame(frame)
  }, [resolvedTheme])

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
        <div className="mt-4 overflow-hidden rounded-md border border-border/50 bg-foreground/5">
          {colorTokens.map((item, index) => {
            const value = tokenValues[item.token] || `var(${item.token})`

            return (
              <div
                key={item.token}
                className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-border/30" : ""}`}
              >
                <span
                  className="size-8 shrink-0 rounded-lg border border-border/60"
                  style={{ background: `var(${item.token})` }}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground">
                    {item.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {item.usage}
                  </p>
                </div>
                <code className="max-w-[180px] truncate rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  {value}
                </code>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
