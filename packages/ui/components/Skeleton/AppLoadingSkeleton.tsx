"use client"

import { useEffect, useState } from "react"
import { AppShellLoadingSkeleton } from "./AppShellLoadingSkeleton"
import { OpenClawSplash } from "./OpenClawSplash"

const FIRST_OPEN_SPLASH_KEY = "openclaw.firstOpenSplashSeen"

function readShouldShowFirstOpenSplash() {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(FIRST_OPEN_SPLASH_KEY) !== "true"
  } catch {
    return false
  }
}

export function AppLoadingSkeleton() {
  const [showSplash] = useState(readShouldShowFirstOpenSplash)

  useEffect(() => {
    if (!showSplash) return
    try {
      window.localStorage.setItem(FIRST_OPEN_SPLASH_KEY, "true")
    } catch {}
  }, [showSplash])

  return showSplash ? <OpenClawSplash /> : <AppShellLoadingSkeleton />
}
