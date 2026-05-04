"use client"

import { cn } from "@/lib/utils"

type TrafficLightsProps = {
  className?: string
}

export function TrafficLights({ className }: TrafficLightsProps) {
  const handleAction = async (action: "minimize" | "fullscreen" | "close") => {
    if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const appWindow = getCurrentWindow()
        if (action === "minimize") await appWindow.minimize()
        else if (action === "fullscreen") await appWindow.setFullscreen(!(await appWindow.isFullscreen()))
        else if (action === "close") await appWindow.close()
      } catch (err) {
        console.error("Tauri IPC error:", err)
      }
    }
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <button
        type="button"
        aria-label="Close"
        onClick={() => handleAction("close")}
        className={cn(
          "group relative flex size-[12px] items-center justify-center rounded-full transition-all cursor-pointer",
          "border border-[#E0443E] bg-[#FF5F56] active:brightness-90",
        )}
      >
        <svg
          viewBox="0 0 10 10"
          className="size-[8px] text-[#4c0000] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          <path
            d="M2.5 2.5 L7.5 7.5 M7.5 2.5 L2.5 7.5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Minimize"
        onClick={() => handleAction("minimize")}
        className={cn(
          "group relative flex size-[12px] items-center justify-center rounded-full transition-all cursor-pointer",
          "border border-[#DEA123] bg-[#FFBD2E] active:brightness-90",
        )}
      >
        <svg
          viewBox="0 0 10 10"
          className="size-[8px] text-[#995700] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          <path
            d="M2 5 L8 5"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
      </button>

      <button
        type="button"
        aria-label="Toggle fullscreen"
        onClick={() => handleAction("fullscreen")}
        className={cn(
          "group relative flex size-[12px] items-center justify-center rounded-full transition-all cursor-pointer",
          "border border-[#1AAB29] bg-[#27C93F] active:brightness-90",
        )}
      >
        <svg
          viewBox="0 0 10 10"
          className="size-[8px] text-[#006500] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
        >
          <path
            d="M6 1 L9 1 L9 4 M9 1 L5.5 4.5 M4 9 L1 9 L1 6 M1 9 L4.5 5.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
