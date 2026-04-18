"use client"

import { cn } from "@/lib/utils"

type WindowControlsProps = {
  className?: string
}

/**
 * Windows-style window controls (minimize, maximize/restore, close).
 * Rendered on the RIGHT side of the header on Windows/Linux.
 * Uses Tauri IPC for native window management.
 */
export function WindowControls({ className }: WindowControlsProps) {
  const handleAction = async (action: "minimize" | "maximize" | "close") => {
    if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const appWindow = getCurrentWindow()
        if (action === "minimize") await appWindow.minimize()
        else if (action === "maximize") await appWindow.toggleMaximize()
        else if (action === "close") await appWindow.close()
      } catch (err) {
        console.error("Tauri IPC error:", err)
      }
    }
  }

  return (
    <div className={cn("flex items-center", className)}>
      {/* Minimize */}
      <button
        type="button"
        aria-label="Minimize"
        onClick={() => handleAction("minimize")}
        className={cn(
          "flex h-9 w-[46px] items-center justify-center",
          "text-muted-foreground transition-colors duration-100 cursor-pointer",
          "hover:bg-foreground/10 hover:text-foreground",
          "active:bg-foreground/15",
        )}
      >
        <svg viewBox="0 0 10 10" className="size-[11px]" fill="none">
          <path
            d="M1 5h8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        aria-label="Maximize"
        onClick={() => handleAction("maximize")}
        className={cn(
          "flex h-9 w-[46px] items-center justify-center",
          "text-muted-foreground transition-colors duration-100 cursor-pointer",
          "hover:bg-foreground/10 hover:text-foreground",
          "active:bg-foreground/15",
        )}
      >
        <svg viewBox="0 0 10 10" className="size-[11px]" fill="none">
          <rect
            x="1.5"
            y="1.5"
            width="7"
            height="7"
            rx="0.5"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      </button>

      {/* Close */}
      <button
        type="button"
        aria-label="Close"
        onClick={() => handleAction("close")}
        className={cn(
          "flex h-9 w-[46px] items-center justify-center",
          "text-muted-foreground transition-colors duration-100 cursor-pointer",
          "hover:bg-[#c42b1c] hover:text-white",
          "active:bg-[#b22a1a] active:text-white",
        )}
      >
        <svg viewBox="0 0 10 10" className="size-[11px]" fill="none">
          <path
            d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  )
}
