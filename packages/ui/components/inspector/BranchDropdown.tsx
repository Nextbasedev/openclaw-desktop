"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { LuCheck } from "react-icons/lu"

export function BranchDropdown({
  branches, current, onSelect, onClose,
}: {
  branches: string[]
  current: string | null
  onSelect: (name: string) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState("")
  const q = search.toLowerCase()
  const filtered = branches.filter((b) => b.toLowerCase().includes(q))

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className={cn(
        "absolute left-0 top-full z-50 mt-1 w-56",
        "rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl",
        "shadow-xl shadow-black/20 overflow-hidden",
      )}>
        <div className="p-1.5">
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter branches…"
            className={cn(
              "h-7 w-full rounded-md border border-border/30 bg-secondary/30 px-2",
              "text-[12px] text-foreground outline-none placeholder:text-muted-foreground/50",
              "focus:border-foreground/20",
            )}
          />
        </div>
        <div className="max-h-48 overflow-y-auto py-1">
          {filtered.map((branch) => (
            <button
              key={branch}
              type="button"
              onClick={() => onSelect(branch)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]",
                "transition-colors hover:bg-secondary/40",
                branch === current
                  ? "text-foreground font-medium"
                  : "text-muted-foreground",
              )}
            >
              {branch === current && <LuCheck size={12} className="shrink-0" />}
              {branch !== current && <span className="w-3 shrink-0" />}
              <span className="truncate">{branch}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-muted-foreground/60">
              No matching branches
            </p>
          )}
        </div>
      </div>
    </>
  )
}
