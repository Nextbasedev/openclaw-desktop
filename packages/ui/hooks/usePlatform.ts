"use client"

import { useState, useEffect } from "react"

export type Platform = "macos" | "windows" | "linux" | "unknown"

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string
  }
}

function detectPlatform(): Platform {
  const nav = navigator as NavigatorWithUserAgentData
  const modern = nav.userAgentData?.platform?.toLowerCase()
  if (modern?.includes("mac")) return "macos"
  if (modern?.includes("win")) return "windows"
  if (modern?.includes("linux")) return "linux"

  const legacy = navigator.platform?.toLowerCase() ?? ""
  if (legacy.includes("mac")) return "macos"
  if (legacy.includes("win")) return "windows"
  if (legacy.includes("linux")) return "linux"
  return "unknown"
}

/**
 * Detects the user's operating system at runtime.
 *
 * Uses navigator APIs (userAgentData → platform fallback).
 * Returns "unknown" during SSR to avoid hydration mismatches.
 */
export function usePlatform(): Platform {
  const [platform, setPlatform] = useState<Platform>("unknown")

  useEffect(() => {
    const timer = window.setTimeout(() => setPlatform(detectPlatform()), 0)
    return () => window.clearTimeout(timer)
  }, [])

  return platform
}
