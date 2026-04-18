"use client"

import { useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

type UpdateEntry = {
  version: string
  date: string
  changes: string[]
  tag?: "latest" | "beta"
}

const UPDATES: UpdateEntry[] = [
  {
    version: "v2.04",
    date: "April 17, 2026",
    tag: "latest",
    changes: [
      "Sidebar with drag-and-drop navigation",
      "New keyboard shortcuts: Ctrl+K search, Ctrl+~ terminal",
      "Version update notifications",
      "Improved theme consistency across components",
    ],
  },
  {
    version: "v2.03",
    date: "April 10, 2026",
    changes: [
      "Settings dialog redesign with tabbed navigation",
      "Custom traffic light controls for macOS",
      "Theme hotkey (D) to toggle dark/light mode",
    ],
  },
  {
    version: "v2.02",
    date: "April 3, 2026",
    tag: "beta",
    changes: [
      "Initial desktop layout with frameless window",
      "Header with user info and version badge",
      "Dark mode support with system preference detection",
    ],
  },
]

type VersionUpdateModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function VersionUpdateModal({
  open,
  onOpenChange,
}: VersionUpdateModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault()
        onOpenChange(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [open, onOpenChange])

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      className={cn(
        "fixed inset-0 z-50 m-auto h-fit max-h-[80vh] w-full max-w-md",
        "overflow-hidden rounded-2xl border border-white/10 bg-[#141620] p-0",
        "text-white shadow-2xl shadow-black/40 backdrop:bg-black/60 backdrop:backdrop-blur-sm",
        "animate-in fade-in zoom-in-95 duration-200",
      )}
      onClose={() => onOpenChange(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/8 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="text-lg">🚀</span>
          <h2 className="text-[15px] font-semibold text-white/95">
            What&apos;s New
          </h2>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className={cn(
            "flex size-7 items-center justify-center rounded-lg",
            "text-white/40 transition-colors",
            "hover:bg-white/10 hover:text-white/70",
          )}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* Update entries */}
      <div className="max-h-[55vh] overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-5">
          {UPDATES.map((entry, idx) => (
            <div
              key={entry.version}
              className="flex flex-col gap-2 animate-in slide-in-from-left-2 fade-in duration-300"
              style={{ animationDelay: `${idx * 80}ms`, animationFillMode: "both" }}
            >
              {/* Version header */}
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-bold text-white/95">
                  {entry.version}
                </span>
                {entry.tag && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      entry.tag === "latest"
                        ? "bg-emerald-400/15 text-emerald-300"
                        : "bg-amber-400/15 text-amber-300",
                    )}
                  >
                    {entry.tag}
                  </span>
                )}
                <span className="text-[11px] text-white/35">{entry.date}</span>
              </div>

              {/* Changes list */}
              <ul className="flex flex-col gap-1.5 pl-1">
                {entry.changes.map((change) => (
                  <li
                    key={change}
                    className="flex items-start gap-2 text-[12px] leading-relaxed text-white/55"
                  >
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-white/25" />
                    {change}
                  </li>
                ))}
              </ul>

              {/* Separator */}
              {idx < UPDATES.length - 1 && (
                <div className="mt-1 border-b border-white/6" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-white/8 px-5 py-3">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className={cn(
            "w-full rounded-xl py-2.5 text-[13px] font-medium",
            "border border-white/12 bg-white/8 text-white/90 transition-all",
            "hover:bg-white/12 active:bg-white/6",
          )}
        >
          Got it
        </button>
      </div>
    </dialog>
  )
}
