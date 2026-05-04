"use client"

import { useEffect, useState } from "react"
import { useTheme } from "next-themes"

import { ThemeSelector } from "@/components/settings/ThemeSelector"

function Switch({ checked, onCheckedChange }: { checked: boolean, onCheckedChange: (c: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none ${checked ? 'bg-blue-500' : 'bg-[#444]'}`}
    >
      <span className={`pointer-events-none block h-[18px] w-[18px] rounded-full shadow-sm transition-transform ${checked ? 'translate-x-[18px] bg-white' : 'translate-x-[2px] bg-white'}`} />
    </button>
  )
}

function rgbToHex(rgb: string) {
  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (!match) return rgb
  const r = parseInt(match[1]).toString(16).padStart(2, "0")
  const g = parseInt(match[2]).toString(16).padStart(2, "0")
  const b = parseInt(match[3]).toString(16).padStart(2, "0")
  return `#${r}${g}${b}`.toUpperCase()
}

function getHexColor(cssStr: string): string {
  if (typeof document === "undefined") return cssStr
  try {
    const canvas = document.createElement("canvas")
    const ctx = canvas.getContext("2d")
    if (!ctx) return cssStr

    ctx.fillStyle = "#123456"
    ctx.fillStyle = cssStr

    let result = ctx.fillStyle

    if (result === "#123456" && cssStr !== "#123456") {
      ctx.fillStyle = `hsl(${cssStr.replace(/ /g, ", ")})`
      result = ctx.fillStyle
      if (result === "#123456") return cssStr
    }

    if (result.startsWith("rgb")) {
      return rgbToHex(result)
    }

    return result.toUpperCase()
  } catch {
    return cssStr
  }
}

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
  const [isTranslucent, setIsTranslucent] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("openclaw.uniqueSidebarBg") === "true"
  })

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

  const handleTranslucentChange = (val: boolean) => {
    setIsTranslucent(val)
    localStorage.setItem("openclaw.uniqueSidebarBg", String(val))
    window.dispatchEvent(new CustomEvent("appearance:sidebar-bg", { detail: val }))
  }

  return (
    <div className="flex flex-col gap-6 pb-8">
      <div>
        <h2 className="text-lg font-semibold text-foreground">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Customize how OpenClaw Desktop looks.
        </p>
      </div>

      <div>
        <h3 className="text-sm mb-3">Theme</h3>
        <ThemeSelector />

        <div className="mt-6 flex items-center justify-between rounded-md border border-border/50 bg-foreground/5 px-4 py-3">
          <span className="text-[14px] text-foreground">Translucent sidebar</span>
          <Switch checked={isTranslucent} onCheckedChange={handleTranslucentChange} />
        </div>

        <div className="mt-4 overflow-hidden rounded-md border border-border/50 bg-foreground/5">
          {colorTokens.map((item, index) => {
            const rawValue = tokenValues[item.token] || `var(${item.token})`
            const hexValue = tokenValues[item.token] ? getHexColor(tokenValues[item.token]) : rawValue

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
                <code className="max-w-[120px] truncate rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                  {hexValue}
                </code>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
