"use client"

import { useState, useEffect, useRef, useCallback } from "react"

export type AppFocusState = "focused" | "blurred" | "background"

export function useAppFocus() {
  const [focusState, setFocusState] = useState<AppFocusState>("focused")
  const focusStateRef = useRef<AppFocusState>("focused")

  const updateState = useCallback((next: AppFocusState) => {
    focusStateRef.current = next
    setFocusState(next)
    console.log("[AppFocus] state:", next)
  }, [])

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) {
        updateState("background")
      } else {
        updateState("focused")
      }
    }

    const handleBlur = () => {
      if (!document.hidden) {
        updateState("blurred")
      }
    }

    const handleFocus = () => {
      updateState("focused")
    }

    // Tauri window focus events (more reliable for desktop)
    const setupTauriListeners = async () => {
      if (typeof window === "undefined") return
      const tauri = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
      if (!tauri) return

      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window")
        const win = getCurrentWindow()

        const unlistenFocus = await win.listen("tauri://focus", () => {
          updateState("focused")
        })
        const unlistenBlur = await win.listen("tauri://blur", () => {
          updateState("blurred")
        })

        return () => {
          unlistenFocus()
          unlistenBlur()
        }
      } catch {
        return undefined
      }
    }

    let cleanupTauri: (() => void) | undefined
    setupTauriListeners().then((cleanup) => {
      cleanupTauri = cleanup
    })

    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("blur", handleBlur)
    window.addEventListener("focus", handleFocus)

    // Set initial state
    if (document.hidden) {
      updateState("background")
    }

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("blur", handleBlur)
      window.removeEventListener("focus", handleFocus)
      cleanupTauri?.()
    }
  }, [updateState])

  const isBackgrounded = focusState === "blurred" || focusState === "background"

  return {
    focusState,
    isBackgrounded,
    isFocused: focusState === "focused",
  }
}
