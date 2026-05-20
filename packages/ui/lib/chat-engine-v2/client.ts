import { frontendLog, redactText, sanitizeForLog, sanitizeUrlForLog } from "../clientLogs"
import { getMiddlewareConnection } from "../middleware-client"
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

function summarizeV2Body(body: BodyInit | null | undefined): unknown {
  if (!body) return undefined
  if (typeof body !== "string") return { type: (body as { constructor?: { name?: string } }).constructor?.name ?? "body" }
  try {
    return sanitizeForLog(JSON.parse(body))
  } catch {
    return { type: "text", length: body.length, preview: "[omitted]" }
  }
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const startedAt = performance.now()
  const method = (init?.method ?? "GET").toUpperCase()
  const baseUrl = getMiddlewareUrl()
  frontendLog("api", "middleware.fetch.start", {
    method,
    path: sanitizeUrlForLog(path),
    baseUrl: sanitizeUrlForLog(baseUrl),
    body: summarizeV2Body(init?.body),
  }, "debug")
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    })
    const text = await response.text()
    const body = text ? JSON.parse(text) : null
    const durationMs = Math.round(performance.now() - startedAt)
    frontendLog("api", response.ok ? "middleware.fetch.end" : "middleware.fetch.fail", {
      method,
      path: sanitizeUrlForLog(path),
      durationMs,
      status: response.status,
      statusText: response.statusText || undefined,
      error: response.ok ? undefined : redactText(body?.error?.message ?? `Middleware request failed (${response.status})`),
    }, response.ok ? "info" : "error")
    if (!response.ok) {
      throw new Error(body?.error?.message ?? `Middleware request failed (${response.status})`)
    }
    return body as T
  } catch (error) {
    frontendLog("api", "middleware.fetch.fail", {
      method,
      path: sanitizeUrlForLog(path),
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? { kind: error.name, message: redactText(error.message) } : { kind: "Error", message: redactText(String(error)) },
    }, "error")
    throw error
  }
}

export async function fetchChatBootstrapV2(sessionKey: string, limit = 200): Promise<ChatBootstrapV2> {
  const params = new URLSearchParams({ sessionKey, limit: String(limit) })
  return fetchJson<ChatBootstrapV2>(`/api/chat/bootstrap?${params.toString()}`)
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
          frontendLog("stream", "patch-stream.bootstrap-recovery", { afterCursor: connectionCursor, replayCount: frame.replayCount, replayHasMore: frame.replayHasMore }, "warn")
          window.dispatchEvent(new CustomEvent("openclaw:chat-bootstrap-recovery"))
          onFrame(frame)
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

  return () => {
    closedByCaller = true
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
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
  })
}

export async function abortChatV2(input: { sessionKey: string; runId?: string }): Promise<{ ok: boolean }> {
  return fetchJson<{ ok: boolean }>("/api/chat/abort", {
    method: "POST",
    body: JSON.stringify(input),
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
