const DEFAULT_V2_URL = "http://127.0.0.1:8989"
const V2_URL_KEY = "openclaw.middleware.v2.url"

function trimTrailingSlash(value: string) {
  return value.trim().replace(/\/+$/, "")
}

export function getMiddlewareV2Url(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(V2_URL_KEY)?.trim()
    if (stored) return trimTrailingSlash(stored)
  }
  return trimTrailingSlash(process.env.NEXT_PUBLIC_MIDDLEWARE_V2_URL?.trim() || DEFAULT_V2_URL)
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getMiddlewareV2Url()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  })
  const text = await response.text()
  const body = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Middleware V2 request failed (${response.status})`)
  }
  return body as T
}

export type ChatBootstrapV2 = {
  ok: boolean
  sessionKey: string
  sessionId?: string | null
  sessionStatus?: string | null
  messages: unknown[]
  messageCount: number
  projection?: { cursor?: number; lastSeq?: number; liveSubscribed?: boolean }
}

export type PatchFrame = {
  type: "patch"
  patch: {
    cursor: number
    type: "chat.message.upsert" | "chat.message.confirmed" | "chat.message.remove" | "session.upsert" | string
    sessionKey: string | null
    payload: unknown
    createdAtMs: number
  }
}

export type HelloFrame = {
  type: "hello"
  clientId: string
  afterCursor: number
  replayCount: number
  replayHasMore?: boolean
}

export type StreamFrame = PatchFrame | HelloFrame

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
  const startCursor = Math.max(0, afterCursor)
  const url = new URL(`${getMiddlewareV2Url()}/api/stream/ws`)
  url.searchParams.set("afterCursor", String(startCursor))
  const ws = new WebSocket(url.toString().replace(/^http/, "ws"))
  let backlogReplay: Promise<void> | null = null
  const liveBuffer: StreamFrame[] = []
  ws.onmessage = (event) => {
    try {
      const frame = JSON.parse(String(event.data)) as StreamFrame
      if (frame.type === "hello" && frame.replayHasMore) {
        backlogReplay = replayPatchBacklog(startCursor, onFrame)
          .then(() => {
            for (const buffered of liveBuffer.splice(0)) onFrame(buffered)
          })
          .catch(() => undefined)
        onFrame(frame)
        return
      }
      if (backlogReplay && frame.type === "patch") {
        liveBuffer.push(frame)
        return
      }
      onFrame(frame)
    } catch {
      // ignore malformed frame
    }
  }
  return () => ws.close()
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
