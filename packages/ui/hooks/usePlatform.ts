"use client"

import { useState, useEffect } from "react"

export type Platform = "macos" | "windows" | "linux" | "unknown"

/**
 * Detects the user's operating system at runtime.
 *
 * Uses navigator APIs (userAgentData → platform fallback).
 * Returns "unknown" during SSR to avoid hydration mismatches.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("unknown")

  useEffect(() => {
    // 1. navigator.userAgentData (modern Chromium-based, including Tauri WebView2)
    if ("userAgentData" in navigator && (navigator as any).userAgentData?.platform) {
      const p = (navigator as any).userAgentData.platform.toLowerCase()
      if (p.includes("mac")) return setPlatform("macos")
      if (p.includes("win")) return setPlatform("windows")
      if (p.includes("linux")) return setPlatform("linux")
    }

    // 2. navigator.platform (legacy fallback)
    const legacy = navigator.platform?.toLowerCase() ?? ""
    if (legacy.includes("mac")) return setPlatform("macos")
    if (legacy.includes("win")) return setPlatform("windows")
    if (legacy.includes("linux")) return setPlatform("linux")

    setPlatform("unknown")
  }, [])

  return platform
}
