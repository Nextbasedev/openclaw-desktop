import { frontendLog, redactText, sanitizeForLog, sanitizeUrlForLog } from "../clientLogs"
import { logChatStreamRecoveryDecision } from "../chatTimelineDiagnostics"
import { getMiddlewareConnection } from "../middleware-client"
import { registerScheduledRequest, type RequestPriority } from "../requestScheduler"
import type { SessionTokenUsage } from "../sessionContextUsage"
import type { ChatBootstrapV2, HelloFrame, PatchFrame, StreamFrame } from "./types"
export type { ActiveRunV2, ChatBootstrapV2, HelloFrame, PatchFrame, RunStatusV2, StreamFrame, ToolCallProjectionV2 } from "./types"

const DEFAULT_MIDDLEWARE_URL = "http://127.0.0.1:8787"
const CONNECTED_MIDDLEWARE_URL_KEY = "openclaw.middleware.url"
const V2_URL_KEY = "openclaw.middleware.v2.url"

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "")
}

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "tauri.localhost" || hostname === "::1"
}

function rewriteLoopbackForRemoteBrowser(rawUrl: string): string {
  if (typeof window === "undefined") return rawUrl
  if (isLoopbackHost(window.location.hostname)) return rawUrl
  try {
    const url = new URL(rawUrl)
    if (!isLoopbackHost(url.hostname)) return rawUrl
    url.hostname = window.location.hostname
    url.port = "8787"
    return url.toString()
  } catch {
    return rawUrl
  }
}

export function getMiddlewareUrl(): string {
  if (typeof window !== "undefined") {
    const connectedMiddlewareUrl = localStorage.getItem(CONNECTED_MIDDLEWARE_URL_KEY)?.trim()
    if (connectedMiddlewareUrl) return trimTrailingSlash(rewriteLoopbackForRemoteBrowser(connectedMiddlewareUrl))

    const stored = localStorage.getItem(V2_URL_KEY)?.trim()
    if (stored) return trimTrailingSlash(rewriteLoopbackForRemoteBrowser(stored))
  }
  return trimTrailingSlash(rewriteLoopbackForRemoteBrowser(process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL?.trim() || DEFAULT_MIDDLEWARE_URL))
}

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

function middlewareLogContext(method: string, path: string, baseUrl: string, extra?: Record<string, unknown>) {
  const targetUrl = middlewareTargetUrl(baseUrl, path)
  return {
    method,
    routePath: sanitizeMiddlewarePath(path),
    targetUrl: sanitizeUrlForLog(targetUrl),
    middlewareBaseUrl: sanitizeUrlForLog(baseUrl),
    ...extra,
  }
}

function summarizeV2Body(body: BodyInit | null | undefined): unknown {
  if (!body) return undefined
  if (typeof body !== "string") return { type: (body as { constructor?: { name?: string } }).constructor?.name ?? "body" }
  try {
    return sanitizeForLog(JSON.parse(body))
  } catch {
    return { type: "text", length: body.length, preview: "[omitted]" }
  }
}

const chatBootstrapRequests = new Map<string, Promise<ChatBootstrapV2>>()
const chatMessagesRequests = new Map<string, Promise<ChatMessagesPageV2>>()

async function fetchJson<T>(path: string, init?: RequestInit & { schedulerPriority?: RequestPriority; schedulerSessionKey?: string | null; schedulerLabel?: string }): Promise<T> {
  const startedAt = performance.now()
  const method = (init?.method ?? "GET").toUpperCase()
  const baseUrl = getMiddlewareUrl()
  frontendLog("api", "middleware.fetch.start", middlewareLogContext(method, path, baseUrl, {
    body: summarizeV2Body(init?.body),
  }), "debug")
  const priority = init?.schedulerPriority ?? "active-chat"
  const scheduled = registerScheduledRequest({
    sessionKey: init?.schedulerSessionKey ?? null,
    priority,
    label: path,
  })
  try {
    const { schedulerPriority: _sp, schedulerSessionKey: _ss, schedulerLabel: _sl, ...fetchInit } = init ?? {} as Record<string, unknown>
    const response = await fetch(middlewareTargetUrl(baseUrl, path), {
      ...fetchInit as RequestInit,
      signal: scheduled.signal,
      headers: {
        "Content-Type": "application/json",
        ...((init as RequestInit | undefined)?.headers ?? {}),
      },
    })
    const text = await response.text()
    const body = text ? JSON.parse(text) : null
    const durationMs = Math.round(performance.now() - startedAt)
    frontendLog("api", response.ok ? "middleware.fetch.end" : "middleware.fetch.fail", middlewareLogContext(method, path, baseUrl, {
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
    const isAbort = error instanceof DOMException && error.name === "AbortError"
    frontendLog("api", isAbort ? "middleware.fetch.abort" : "middleware.fetch.fail", middlewareLogContext(method, path, baseUrl, {
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
      schedulerPriority: priority,
    }), isAbort ? "debug" : "error")
    throw error
  } finally {
    scheduled.unregister()
  }
}

export async function fetchChatBootstrapV2(sessionKey: string): Promise<ChatBootstrapV2> {
  const key = `bootstrap:${sessionKey}`
  const existing = chatBootstrapRequests.get(key)
  if (existing) return existing
  const params = new URLSearchParams({ sessionKey })
  const request = fetchJson<ChatBootstrapV2>(`/api/chat/bootstrap?${params.toString()}`, {
    schedulerPriority: "active-chat",
    schedulerSessionKey: sessionKey,
    schedulerLabel: `bootstrap:${sessionKey}`,
  }).finally(() => {
    chatBootstrapRequests.delete(key)
  })
  chatBootstrapRequests.set(key, request)
  return request
}

export type ChatMessagesPageV2 = {
  ok: boolean
  source?: string
  sessionKey: string
  messages: Array<{
    sessionKey: string
    openclawSeq: number
    gatewaySeq?: number | null
    segmentId?: string | null
    messageId: string | null
    role: string | null
    data: unknown
    updatedAtMs: number
  }>
  messageCount: number
  cursor?: number
  // BUG-3 (docs/audit/frontend-window-audit-2026-06-17.md): server pagination
  // envelope. The middleware (Agent F1) is adding these to /api/chat/messages
  // responses so the frontend stops guessing hasOlder from `returnedCount >=
  // requestedLimit` (wrong on exact-fit pages and after normalizeHistory
  // filtering). All fields are optional for backwards compatibility — callers
  // must fall back to the legacy heuristic when undefined.
  hasOlder?: boolean
  hasNewer?: boolean
  oldestSeq?: number | null
  newestSeq?: number | null
  epoch?: number
}

export async function fetchChatMessagesV2(input: {
  sessionKey: string
  beforeSeq?: number
  afterSeq?: number
  limit?: number
}): Promise<ChatMessagesPageV2> {
  const params = new URLSearchParams({ sessionKey: input.sessionKey })
  if (typeof input.limit === "number") params.set("limit", String(input.limit))
  if (typeof input.beforeSeq === "number") params.set("beforeSeq", String(input.beforeSeq))
  if (typeof input.afterSeq === "number") params.set("afterSeq", String(input.afterSeq))
  const key = `messages:${params.toString()}`
  const existing = chatMessagesRequests.get(key)
  if (existing) return existing
  const request = fetchJson<ChatMessagesPageV2>(`/api/chat/messages?${params.toString()}`, {
    schedulerPriority: "active-chat",
    schedulerSessionKey: input.sessionKey,
    schedulerLabel: `messages:${input.sessionKey}`,
  }).finally(() => {
    chatMessagesRequests.delete(key)
  })
  chatMessagesRequests.set(key, request)
  return request
}

export async function fetchSessionContextUsage(sessionKey: string): Promise<{
  ok: boolean
  sessionKey: string
  usage: SessionTokenUsage | null
  updatedAtMs: number
}> {
  const params = new URLSearchParams({ sessionKey })
  return fetchJson(`/api/chat/session-context?${params.toString()}`, {
    schedulerPriority: "active-chat",
    schedulerSessionKey: sessionKey,
    schedulerLabel: `session-context:${sessionKey}`,
  })
}

async function replayPatchBacklog(afterCursor: number, onFrame: (frame: StreamFrame) => void) {
  let cursor = Math.max(0, afterCursor)
  for (let i = 0; i < 25; i++) {
    const params = new URLSearchParams({ afterCursor: String(cursor), limit: "1000" })
    const body = await fetchJson<{ patches: PatchFrame["patch"][]; hasMore: boolean; latestCursor: number }>(`/api/patches?${params.toString()}`)
    for (const patch of body.patches) onFrame({ type: "patch", patch })
    if (!body.hasMore || body.latestCursor <= cursor) break
    cursor = body.latestCursor
  }
}

export function openPatchStreamV2(afterCursor: number, onFrame: (frame: StreamFrame) => void): () => void {
  if (typeof window === "undefined") return () => undefined
  let closedByCaller = false
  let reconnectTimer: number | null = null
  let ws: WebSocket | null = null
  let cursor = Math.max(0, afterCursor)
  let reconnectAttempt = 0
  let suppressReplayUntilCursor = 0

  const connect = () => {
    if (closedByCaller) return
    const connectionCursor = cursor
    const url = new URL(`${getMiddlewareUrl()}/api/stream/ws`)
    url.searchParams.set("afterCursor", String(connectionCursor))
    const wsUrl = url.toString().replace(/^http/, "ws")
    frontendLog("stream", reconnectAttempt === 0 ? "patch-stream.start" : "patch-stream.reconnect", {
      url: sanitizeUrlForLog(wsUrl),
      afterCursor: connectionCursor,
      attempt: reconnectAttempt,
    })
    const socket = new WebSocket(wsUrl)
    ws = socket
    let backlogReplay: Promise<void> | null = null
    const liveBuffer: StreamFrame[] = []

    socket.onopen = () => {
      reconnectAttempt = 0
      frontendLog("stream", "patch-stream.open", { url: sanitizeUrlForLog(wsUrl), afterCursor: connectionCursor }, "debug")
    }
    socket.onerror = () => {
      frontendLog("stream", "patch-stream.error", { url: sanitizeUrlForLog(wsUrl), afterCursor: connectionCursor }, "error")
    }
    socket.onclose = (event) => {
      frontendLog("stream", "patch-stream.close", { url: sanitizeUrlForLog(wsUrl), code: event.code, clean: event.wasClean, closedByCaller }, event.wasClean || closedByCaller ? "info" : "warn")
      if (closedByCaller) return
      reconnectAttempt += 1
      const delayMs = Math.min(10_000, 500 * 2 ** Math.min(5, reconnectAttempt - 1))
      frontendLog("stream", "patch-stream.reconnect-scheduled", { afterCursor: cursor, attempt: reconnectAttempt, delayMs }, "warn")
      reconnectTimer = window.setTimeout(connect, delayMs)
    }
    socket.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as StreamFrame
        if (frame.type === "patch") cursor = Math.max(cursor, frame.patch.cursor)
        frontendLog("stream", "patch-stream.event", {
          frameType: frame.type,
          cursor: frame.type === "patch" ? frame.patch.cursor : undefined,
          patchType: frame.type === "patch" ? frame.patch.type : undefined,
          sessionKey: frame.type === "patch" ? frame.patch.sessionKey : undefined,
          replayCount: frame.type === "hello" ? frame.replayCount : undefined,
          replayHasMore: frame.type === "hello" ? frame.replayHasMore : undefined,
        }, "debug")
        if (frame.type === "hello" && (frame.recovery === "bootstrap" || frame.replayWindowExceeded)) {
          suppressReplayUntilCursor = Math.max(
            suppressReplayUntilCursor,
            connectionCursor + Math.max(0, frame.replayCount ?? 0),
          )
          frontendLog("stream", "patch-stream.bootstrap-recovery", { afterCursor: connectionCursor, replayCount: frame.replayCount, replayHasMore: frame.replayHasMore }, "warn")
          logChatStreamRecoveryDecision({
            targetSessionKey: null,
            activeSessionKey: null,
            renderedSessionKey: null,
            cursor: connectionCursor,
            willApply: true,
            reason: frame.replayWindowExceeded ? "replay-window-exceeded" : "stream-hello-recovery",
            extra: {
              replayCount: frame.replayCount,
              replayHasMore: frame.replayHasMore,
            },
          })
          window.dispatchEvent(new CustomEvent("openclaw:chat-bootstrap-recovery", {
            detail: {
              reason: frame.replayWindowExceeded ? "replay-window-exceeded" : "stream-hello-recovery",
              cursor: connectionCursor,
            },
          }))
          onFrame(frame)
          return
        }
        if (frame.type === "patch" && suppressReplayUntilCursor > 0 && frame.patch.cursor <= suppressReplayUntilCursor) {
          frontendLog("stream", "patch-stream.recovery-replay-skip", {
            cursor: frame.patch.cursor,
            suppressReplayUntilCursor,
            patchType: frame.patch.type,
            sessionKey: frame.patch.sessionKey,
          }, "debug")
          return
        }
        if (frame.type === "hello" && frame.replayHasMore) {
          frontendLog("stream", "patch-stream.backlog.start", { afterCursor: connectionCursor, replayCount: frame.replayCount }, "debug")
          backlogReplay = replayPatchBacklog(connectionCursor, (replayed) => {
            if (replayed.type === "patch") cursor = Math.max(cursor, replayed.patch.cursor)
            onFrame(replayed)
          })
            .then(() => {
              frontendLog("stream", "patch-stream.backlog.end", { bufferedEvents: liveBuffer.length }, "debug")
              backlogReplay = null
              for (const buffered of liveBuffer.splice(0)) onFrame(buffered)
            })
            .catch((error) => {
              backlogReplay = null
              frontendLog("stream", "patch-stream.backlog.error", {
                error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
              }, "error")
            })
          onFrame(frame)
          return
        }
        if (backlogReplay && frame.type === "patch") {
          liveBuffer.push(frame)
          return
        }
        onFrame(frame)
      } catch (error) {
        frontendLog("stream", "patch-stream.malformed-event", {
          error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
        }, "warn")
      }
    }
  }

  connect()

  let reconnecting = false
  const safeReconnect = (reason: string) => {
    if (closedByCaller || reconnecting) return
    const state = ws?.readyState ?? WebSocket.CLOSED
    if (state === WebSocket.OPEN) return // already connected
    reconnecting = true
    frontendLog("stream", `patch-stream.${reason}`, { readyState: state, cursor }, reason === "health-check.dead" ? "warn" : "info")
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    reconnectAttempt = 0
    try { ws?.close() } catch {}
    ws = null
    connect()
    // Reset guard after connect starts (connect is sync, WS creation is sync)
    reconnecting = false
  }

  // Periodic health check — detect silent WS disconnects
  const healthCheckInterval = typeof window !== "undefined" && window.setInterval
    ? window.setInterval(() => safeReconnect("health-check.dead"), 15_000)
    : null

  // Reconnect on app focus — OS may have killed the socket while backgrounded
  const handleVisibilityChange = () => {
    if (document.hidden) return
    safeReconnect("focus-reconnect")
  }
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange)
  if (typeof window !== "undefined") window.addEventListener("focus", handleVisibilityChange)

  return () => {
    closedByCaller = true
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    if (healthCheckInterval) window.clearInterval(healthCheckInterval)
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibilityChange)
    if (typeof window !== "undefined") window.removeEventListener("focus", handleVisibilityChange)
    frontendLog("stream", "patch-stream.unsubscribe", { afterCursor: cursor }, "debug")
    ws?.close()
  }
}

export type SendChatV2Input = {
  sessionKey: string
  text: string
  attachments?: unknown
  idempotencyKey: string
  clientMessageId?: string
  replyTo?: { messageId: string; snippet: string }
  autonomyMode?: string | null
  execPolicy?: unknown
}

export async function sendChatV2(input: SendChatV2Input): Promise<{ ok: boolean; sessionKey: string; idempotencyKey: string }> {
  return fetchJson<{ ok: boolean; sessionKey: string; idempotencyKey: string }>("/api/chat/send", {
    method: "POST",
    body: JSON.stringify(input),
    schedulerPriority: "critical",
    schedulerSessionKey: input.sessionKey,
    schedulerLabel: `send:${input.sessionKey}`,
  })
}

export async function abortChatV2(input: { sessionKey: string; runId?: string }): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>("/api/chat/abort", {
    method: "POST",
    body: JSON.stringify(input),
    schedulerPriority: "critical",
    schedulerSessionKey: input.sessionKey,
    schedulerLabel: `abort:${input.sessionKey}`,
  })
}

export async function resolveExecApprovalV2(input: {
  approvalId: string
  decision: "allow-once" | "allow-always" | "deny"
}): Promise<{ ok: boolean; approvalId: string; decision: string }> {
  return fetchJson<{ ok: boolean; approvalId: string; decision: string }>("/api/exec/approval/resolve", {
    method: "POST",
    body: JSON.stringify(input),
  })
}
