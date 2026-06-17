import { frontendLog, redactText, sanitizeUrlForLog } from "./clientLogs"

const URL_KEY = "openclaw.middleware.url"
const TOKEN_KEY = "openclaw.middleware.token"
const MANUAL_DISCONNECT_KEY = "openclaw.middleware.manualDisconnect"
const ACTIVE_PROJECT_KEY = "openclaw.activeProjectId"

export const MIDDLEWARE_CONNECTION_CHANGED_EVENT = "openclaw:middleware-connection-changed"
export const MIDDLEWARE_DISCONNECTED_EVENT = "openclaw:middleware-disconnected"

let crossWindowSyncInitialized = false

export type MiddlewareConnection = {
  url: string
  token: string
}

export type MiddlewareHealth = {
  ok: boolean
  service: string
  version: string
  host?: string
  openclaw?: { gatewayUrl?: string; connected?: boolean }
  gateway?: { connected?: boolean; lastError?: string | null }
  pairing?: { enabled?: boolean }
}

export type MiddlewarePairingResult = MiddlewareConnection & {
  ok: boolean
  mode?: "local" | "remote"
}

const LOCAL_MIDDLEWARE_URLS = [
  "http://127.0.0.1:8787",
  "http://localhost:8787",
]

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "tauri.localhost" || hostname === "::1" || hostname === "0.0.0.0"
}

function getBrowserHostname() {
  if (typeof window === "undefined") return null
  return window.location?.hostname || null
}

function rewriteLoopbackForRemoteBrowser(rawUrl: string): string {
  const browserHostname = getBrowserHostname()
  if (!browserHostname || isLoopbackHost(browserHostname)) return rawUrl
  try {
    const url = new URL(rawUrl)
    if (!isLoopbackHost(url.hostname)) return rawUrl
    url.hostname = browserHostname
    return url.toString()
  } catch {
    return rawUrl
  }
}

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__)
}

function backendModeForUrl(url: string): "local" | "remote" {
  try {
    return isLoopbackHost(new URL(url).hostname) ? "local" : "remote"
  } catch {
    return "remote"
  }
}

async function setDesktopBackendMode(mode: "local" | "remote") {
  if (!isTauriRuntime()) return
  try {
    const { invoke } = await import("@tauri-apps/api/core")
    await invoke("set_backend_mode", { mode })
    frontendLog("connection", "desktop.backend-mode.synced", { mode }, "debug")
  } catch (error) {
    frontendLog("connection", "desktop.backend-mode.sync-fail", {
      mode,
      error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
    }, "warn")
  }
}

function syncDesktopBackendMode(connection = getMiddlewareConnection()) {
  void setDesktopBackendMode(connection ? backendModeForUrl(connection.url) : "local")
}

export function getMiddlewareConnection(): MiddlewareConnection | null {
  if (typeof window === "undefined") return null
  const url = localStorage.getItem(URL_KEY)?.trim() ?? ""
  const token = localStorage.getItem(TOKEN_KEY)?.trim() ?? ""
  if (!url) return null
  return { url: trimTrailingSlash(rewriteLoopbackForRemoteBrowser(url)), token }
}

function clearWorkspaceScopeCache() {
  try { localStorage.removeItem(ACTIVE_PROJECT_KEY) } catch {}
}

export function saveMiddlewareConnection(input: MiddlewareConnection) {
  if (typeof window === "undefined") return
  const next = { url: trimTrailingSlash(input.url), token: input.token.trim() }
  const previous = getMiddlewareConnection()
  const changed = previous?.url !== next.url || previous?.token !== next.token
  const workspaceChanged = previous?.url !== next.url
  frontendLog("connection", changed ? "middleware.save.changed" : "middleware.save.updated", {
    url: sanitizeUrlForLog(next.url),
    hadToken: Boolean(next.token),
  })
  localStorage.setItem(URL_KEY, next.url)
  localStorage.setItem(TOKEN_KEY, next.token)
  localStorage.removeItem(MANUAL_DISCONNECT_KEY)
  localStorage.setItem("jarvis.gatewayActive", "true")
  syncDesktopBackendMode(next)
  if (workspaceChanged) {
    clearWorkspaceScopeCache()
    window.dispatchEvent(new CustomEvent(MIDDLEWARE_CONNECTION_CHANGED_EVENT, { detail: { url: next.url } }))
  }
}

export function clearMiddlewareConnection() {
  if (typeof window === "undefined") return
  const previous = getMiddlewareConnection()
  frontendLog("connection", "middleware.disconnect", {
    url: previous ? sanitizeUrlForLog(previous.url) : null,
  })
  localStorage.removeItem(URL_KEY)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.setItem(MANUAL_DISCONNECT_KEY, "true")
  localStorage.setItem("jarvis.gatewayActive", "false")
  clearWorkspaceScopeCache()
  syncDesktopBackendMode(null)
  // Clear ALL cached data from the previous connection
  void clearAllConnectionCaches()
  if (previous) {
    window.dispatchEvent(new CustomEvent(MIDDLEWARE_DISCONNECTED_EVENT, { detail: { url: previous.url } }))
    window.dispatchEvent(new CustomEvent(MIDDLEWARE_CONNECTION_CHANGED_EVENT, { detail: { url: null } }))
  }
}

export function clearMiddlewareManualDisconnect() {
  if (typeof window === "undefined") return
  localStorage.removeItem(MANUAL_DISCONNECT_KEY)
}

export function wasMiddlewareManuallyDisconnected() {
  if (typeof window === "undefined") return false
  return localStorage.getItem(MANUAL_DISCONNECT_KEY) === "true"
}

async function clearAllConnectionCaches() {
  try {
    // Clear persisted cache (IndexedDB + localStorage)
    const { persistentCacheClearAll } = await import("./persistentCache")
    await persistentCacheClearAll()
    // Clear startup bootstrap cache
    const { invalidateMiddlewareStartupBootstrap } = await import("./startupBootstrap")
    invalidateMiddlewareStartupBootstrap()
    // Clear chat list cache
    const { invalidateChatListCache } = await import("./chatListCache")
    invalidateChatListCache()
    // Clear request dedupe
    const { clearDedupeForTests: clearDedupe } = await import("./requestDedupe")
    clearDedupe()
    // Clear patch stream cursor
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("openclaw:patchCursor:") || key.startsWith("openclaw-ui-cache:")) {
        localStorage.removeItem(key)
      }
    }
    frontendLog("connection", "middleware.caches-cleared", {}, "info")
  } catch (error) {
    frontendLog("connection", "middleware.caches-clear-fail", {
      error: error instanceof Error ? error.message : String(error),
    }, "warn")
  }
}

export function initMiddlewareConnectionCrossWindowSync() {
  if (crossWindowSyncInitialized || typeof window === "undefined") return
  crossWindowSyncInitialized = true

  window.addEventListener("storage", (event) => {
    if (event.key !== URL_KEY && event.key !== TOKEN_KEY) return
    if (event.oldValue === event.newValue) return

    const current = getMiddlewareConnection()
    clearWorkspaceScopeCache()

    syncDesktopBackendMode(current)

    if (!current) {
      window.dispatchEvent(new CustomEvent(MIDDLEWARE_DISCONNECTED_EVENT, { detail: { url: event.oldValue ?? null } }))
      window.dispatchEvent(new CustomEvent(MIDDLEWARE_CONNECTION_CHANGED_EVENT, { detail: { url: null } }))
      return
    }

    window.dispatchEvent(new CustomEvent(MIDDLEWARE_CONNECTION_CHANGED_EVENT, { detail: { url: current.url } }))
    window.dispatchEvent(new CustomEvent("openclaw:middleware-connected", { detail: { url: current.url } }))
  })
}

const DEFAULT_MIDDLEWARE_FETCH_TIMEOUT_MS = 8_000
const CONNECTION_PROBE_TIMEOUT_MS = 3_000

type MiddlewareRequestInit = RequestInit & { timeoutMs?: number }

function sanitizeMiddlewarePath(path: string): string {
  try {
    const parsed = new URL(path, "http://openclaw.local")
    const queryKeys = Array.from(parsed.searchParams.keys())
    const querySuffix = queryKeys.length > 0 ? `?${queryKeys.map((key) => `${key}=…`).join("&")}` : ""
    return `${parsed.pathname}${querySuffix}`
  } catch {
    const [base, query = ""] = path.split("?")
    if (!query) return base || path
    const params = new URLSearchParams(query)
    const queryKeys = Array.from(params.keys())
    const querySuffix = queryKeys.length > 0 ? `?${queryKeys.map((key) => `${key}=…`).join("&")}` : ""
    return `${base}${querySuffix}`
  }
}

function middlewareTargetUrl(baseUrl: string, path: string): string {
  try {
    return new URL(path, `${trimTrailingSlash(baseUrl)}/`).toString()
  } catch {
    return `${trimTrailingSlash(baseUrl)}${path.startsWith("/") ? "" : "/"}${path}`
  }
}

function middlewareLogContext(method: string, path: string, baseUrl: string, token: string, extra?: Record<string, unknown>) {
  const targetUrl = middlewareTargetUrl(baseUrl, path)
  return {
    method,
    routePath: sanitizeMiddlewarePath(path),
    targetUrl: sanitizeUrlForLog(targetUrl),
    middlewareBaseUrl: sanitizeUrlForLog(baseUrl),
    hasToken: Boolean(token),
    ...extra,
  }
}

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController()
  const timer = globalThis.setTimeout(() => controller.abort(new Error(`Middleware request timed out after ${timeoutMs}ms`)), timeoutMs)
  return { signal: controller.signal, clear: () => globalThis.clearTimeout(timer) }
}

export async function middlewareFetch<T>(path: string, init: MiddlewareRequestInit = {}, connection = getMiddlewareConnection()): Promise<T> {
  if (!connection) throw new Error("Middleware connection is not configured")
  const startedAt = performance.now()
  const method = (init.method ?? "GET").toUpperCase()
  const token = connection.token.trim()
  const url = trimTrailingSlash(rewriteLoopbackForRemoteBrowser(connection.url))
  const timeout = init.signal ? null : timeoutSignal(init.timeoutMs ?? DEFAULT_MIDDLEWARE_FETCH_TIMEOUT_MS)
  const { timeoutMs: _timeoutMs, ...fetchInit } = init
  frontendLog("api", "middleware.fetch.start", middlewareLogContext(method, path, url, token), "debug")
  try {
    const response = await fetch(middlewareTargetUrl(url, path), {
      ...fetchInit,
      signal: init.signal ?? timeout?.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "Authorization": `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
    })
    const text = await response.text()
    const body = text ? JSON.parse(text) : null
    const durationMs = Math.round(performance.now() - startedAt)
    frontendLog("api", response.ok ? "middleware.fetch.end" : "middleware.fetch.fail", middlewareLogContext(method, path, url, token, {
      durationMs,
      status: response.status,
      statusText: response.statusText || undefined,
      error: response.ok ? undefined : redactText(body?.error?.message ?? `Middleware request failed (${response.status})`),
    }), response.ok ? "info" : "error")
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `Middleware request failed (${response.status})`)
    }
    return body as T
  } catch (error) {
    frontendLog("api", "middleware.fetch.fail", middlewareLogContext(method, path, url, token, {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
    }), "error")
    throw error
  } finally {
    timeout?.clear()
  }
}

export function isOpenClawConnected(health: MiddlewareHealth | null | undefined): boolean {
  return health?.openclaw?.connected === true || health?.gateway?.connected === true
}

export async function testMiddlewareConnection(input: MiddlewareConnection): Promise<MiddlewareHealth> {
  const url = trimTrailingSlash(rewriteLoopbackForRemoteBrowser(input.url))
  frontendLog("connection", "middleware.connect.start", { url: sanitizeUrlForLog(url), hasToken: Boolean(input.token.trim()) })
  try {
    const health = await middlewareFetch<MiddlewareHealth>("/health", { headers: { "Cache-Control": "no-cache" }, timeoutMs: CONNECTION_PROBE_TIMEOUT_MS }, { url, token: "" })
    await middlewareFetch("/api/version", { timeoutMs: CONNECTION_PROBE_TIMEOUT_MS }, { url, token: input.token.trim() })
    frontendLog("connection", "middleware.connect.success", {
      url: sanitizeUrlForLog(url),
      service: health.service,
      version: health.version,
      gatewayConnected: isOpenClawConnected(health),
    })
    return health
  } catch (error) {
    frontendLog("connection", "middleware.connect.fail", {
      url: sanitizeUrlForLog(url),
      error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
    }, "error")
    throw error
  }
}

export async function claimMiddlewarePairing(input: { url: string; code: string }): Promise<MiddlewarePairingResult> {
  const url = trimTrailingSlash(input.url)
  const response = await fetch(`${url}/pairing/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: input.code.trim() }),
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) throw new Error(body?.error?.message ?? `Pairing failed (${response.status})`)
  return { ok: true, url: trimTrailingSlash(body.url || url), token: String(body.token ?? ""), mode: body.mode }
}

if (typeof window !== "undefined") {
  window.setTimeout(() => syncDesktopBackendMode(), 0)
}

export async function detectLocalMiddleware(urls = LOCAL_MIDDLEWARE_URLS): Promise<MiddlewarePairingResult | null> {
  const browserHostname = getBrowserHostname()
  if (browserHostname && !isLoopbackHost(browserHostname)) return null
  for (const rawUrl of urls) {
    const url = trimTrailingSlash(rawUrl)
    try {
      frontendLog("connection", "middleware.detect.probe", { url: sanitizeUrlForLog(url) }, "debug")
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 800)
      const health = await fetch(`${url}/health`, { signal: controller.signal, headers: { "Cache-Control": "no-cache" } })
      clearTimeout(timeout)
      if (!health.ok) continue
      const healthBody = await health.json().catch(() => null) as MiddlewareHealth | null
      if (!isOpenClawConnected(healthBody)) continue
      frontendLog("connection", "middleware.detect.success", { url: sanitizeUrlForLog(url) })
      return { ok: true, url, token: "", mode: "local" }
    } catch (error) {
      frontendLog("connection", "middleware.detect.fail", {
        url: sanitizeUrlForLog(url),
        error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
      }, "debug")
    }
  }
  return null
}
