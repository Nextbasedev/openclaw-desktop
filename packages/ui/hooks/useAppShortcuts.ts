"use client"

import { useEffect } from "react"

/**
 * Global application keyboard shortcuts.
 *
 * - Ctrl+Q (Windows/Linux) or Cmd+Q (macOS) → Quit
 */
export function useAppShortcuts() {
  useEffect(() => {
    const isMac = navigator.platform?.toLowerCase().includes("mac")

    const handleKeyDown = async (e: KeyboardEvent) => {
      const modKey = isMac ? e.metaKey : e.ctrlKey

      // Quit: Ctrl+Q (Win/Linux) or Cmd+Q (Mac)
      if (modKey && e.key.toLowerCase() === "q") {
        e.preventDefault()

        if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window")
            const appWindow = getCurrentWindow()
            await appWindow.close()
          } catch (err) {
            console.error("Failed to close window:", err)
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])
}
