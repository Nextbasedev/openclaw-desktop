"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import type { SortOption } from "./types"

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "downloads", label: "Most Downloaded" },
  { value: "updated", label: "Recently Updated" },
  { value: "stars", label: "Most Starred" },
  { value: "installs", label: "Most Installed" },
  { value: "trending", label: "Trending" },
  { value: "name", label: "Name" },
]

export function SortDropdown({
  value,
  onChange,
}: {
  value: SortOption
  onChange: (v: SortOption) => void
}) {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)
  const current = SORT_OPTIONS.find((o) => o.value === value)

  React.useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border border-border/60",
          "bg-card px-3 pr-8 text-[13px] text-foreground outline-none",
          "transition-colors hover:border-foreground/20",
        )}
      >
        {current?.label ?? "Sort"}
      </button>
      <svg
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      >
        <path
          d="m5 7.5 5 5 5-5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {open && (
        <div
          className={cn(
            "absolute right-0 top-[calc(100%+6px)] z-50 min-w-[180px]",
            "rounded-[14px] p-1.5",
            "bg-[var(--glass-bg)] backdrop-blur-[32px] backdrop-saturate-[180%]",
            "border border-border/15 shadow-xl shadow-black/30",
          )}
        >
          {SORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
              className={cn(
                "flex w-full items-center rounded-[8px] px-3 py-2 text-[13px]",
                "transition-colors",
                opt.value === value
                  ? "bg-foreground/10 text-foreground font-medium"
                  : "text-foreground/80 hover:bg-foreground/5 hover:text-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
