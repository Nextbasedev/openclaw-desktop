"use client"

import { useEffect } from "react"

export function useTerminalShortcut(onToggle: () => void) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Cmd+` on Mac, Ctrl+` on Windows/Linux
      const isMac = navigator.platform?.toUpperCase().includes("MAC")
      const modifier = isMac ? e.metaKey : e.ctrlKey

      if (modifier && e.key === "`") {
        e.preventDefault()
        onToggle()
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onToggle])
}
