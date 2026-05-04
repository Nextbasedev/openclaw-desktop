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

function resolveTokenToHex(token: string): string {
  if (typeof document === "undefined") return token
  try {
    // 1. Let the browser's CSS engine resolve the custom property
    const el = document.createElement("div")
    el.style.cssText = `position:fixed;opacity:0;pointer-events:none;background-color:var(${token})`
    document.body.appendChild(el)
    const computed = getComputedStyle(el).backgroundColor
    document.body.removeChild(el)
    
    if (!computed || computed === "rgba(0, 0, 0, 0)") return token

    // 2. Render the computed color string to a 1x1 canvas to extract exact RGB pixels
    // This handles any modern CSS color format (oklch, color(), lab, etc.) natively
    const canvas = document.createElement("canvas")
    canvas.width = 1
    canvas.height = 1
    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return computed

    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    
    const data = ctx.getImageData(0, 0, 1, 1).data
    if (data[3] === 0) return computed // fully transparent / invalid

    const toHex = (n: number) => n.toString(16).padStart(2, "0")
    return `#${toHex(data[0])}${toHex(data[1])}${toHex(data[2])}`
  } catch {
    return token
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
  const [hexValues, setHexValues] = useState<Record<string, string>>({})
  const [isTranslucent, setIsTranslucent] = useState(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("openclaw.uniqueSidebarBg") === "true"
  })

  useEffect(() => {
    // rAF ensures styles are committed before we read computed values
    const frame = requestAnimationFrame(() => {
      setHexValues(
        Object.fromEntries(
          colorTokens.map((item) => [
            item.token,
            resolveTokenToHex(item.token),
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
            const hexValue = hexValues[item.token] || "…"

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
