"use client"

import { on } from "@/lib/events"
import {
  MIDDLEWARE_CONNECTION_CHANGED_EVENT,
  MIDDLEWARE_DISCONNECTED_EVENT,
} from "@/lib/middleware-client"
import {
  invalidateMiddlewareStartupBootstrap,
  refreshMiddlewareStartupBootstrap,
} from "@/lib/startupBootstrap"
import { persistentCacheClearAll } from "@/lib/persistentCache"

let initialized = false

function clearAllLocalCache() {
  invalidateMiddlewareStartupBootstrap()
  void persistentCacheClearAll()
}

export function initFrontendCacheRealtimeInvalidation() {
  if (initialized || typeof window === "undefined") return
  initialized = true

  on("sidebar:refresh", () => {
    invalidateMiddlewareStartupBootstrap()
    void refreshMiddlewareStartupBootstrap()
  })
  on("archive:changed", () => {
    invalidateMiddlewareStartupBootstrap()
    void refreshMiddlewareStartupBootstrap()
  })
  on("chat:activity", () => {
    invalidateMiddlewareStartupBootstrap()
    void refreshMiddlewareStartupBootstrap()
  })

  window.addEventListener(MIDDLEWARE_CONNECTION_CHANGED_EVENT, clearAllLocalCache)
  window.addEventListener(MIDDLEWARE_DISCONNECTED_EVENT, clearAllLocalCache)
  window.addEventListener("storage", (event) => {
    if (
      event.key === "openclaw.middleware.url" ||
      event.key === "openclaw.middleware.token" ||
      event.key === "jarvis.gatewayActive"
    ) {
      clearAllLocalCache()
    }
  })
}
