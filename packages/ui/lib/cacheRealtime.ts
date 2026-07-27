"use client"

import { on } from "@/lib/events"
import { MIDDLEWARE_CONNECTION_CHANGED_EVENT } from "@/lib/middleware-client"
import {
  invalidateMiddlewareStartupBootstrap,
  refreshMiddlewareStartupBootstrap,
} from "@/lib/startupBootstrap"
import { persistentCacheClearAll } from "@/lib/persistentCache"

let initialized = false
let lastRefreshAt = 0
const REVALIDATE_THROTTLE_MS = 2000

function clearAllLocalCache() {
  invalidateMiddlewareStartupBootstrap()
  void persistentCacheClearAll()
}

function revalidateSoon() {
  const now = Date.now()
  if (now - lastRefreshAt < REVALIDATE_THROTTLE_MS) return
  lastRefreshAt = now
  void refreshMiddlewareStartupBootstrap()
}

export function initFrontendCacheRealtimeInvalidation() {
  if (initialized || typeof window === "undefined") return
  initialized = true

  on("sidebar:refresh", revalidateSoon)
  on("archive:changed", () => {
    invalidateMiddlewareStartupBootstrap()
    revalidateSoon()
  })
  on("chat:activity", () => {
    invalidateMiddlewareStartupBootstrap()
    revalidateSoon()
  })

  window.addEventListener("focus", revalidateSoon)
  window.addEventListener("online", revalidateSoon)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") revalidateSoon()
  })

  window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, (event) => {
    const nextUrl = event instanceof CustomEvent ? event.detail?.url : null
    if (nextUrl) clearAllLocalCache()
  })
  window.addEventListener("storage", (event) => {
    if (event.key === "openclaw.middleware.url" && event.newValue && event.oldValue !== event.newValue) {
      clearAllLocalCache()
    }
    if (event.key === "openclaw.middleware.token" && event.newValue && event.oldValue !== event.newValue) {
      clearAllLocalCache()
    }
  })
}
