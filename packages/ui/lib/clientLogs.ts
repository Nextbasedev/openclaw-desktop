"use client"

export type LogLevel = "log" | "info" | "warn" | "error" | "debug"
export type LogSource = "frontend" | "backend"

export type LogEntry = {
  id: string
  timestamp: number
  level: LogLevel
  source: LogSource
  message: string
}

const MAX_ENTRIES = 1000
let buffer: LogEntry[] = []
const subscribers = new Set<(entries: LogEntry[]) => void>()
let initialized = false
let counter = 0

let notifyScheduled = false
function notify() {
  if (notifyScheduled) return
  notifyScheduled = true
  requestAnimationFrame(() => {
    notifyScheduled = false
    const snapshot = buffer.slice()
    subscribers.forEach((fn) => fn(snapshot))
  })
}

function pushFrontend(level: LogLevel, message: string) {
  counter += 1
  const entry: LogEntry = {
    id: `f-${counter}`,
    timestamp: Date.now(),
    level,
    source: "frontend",
    message,
  }
  buffer.push(entry)
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES)
  }
  notify()
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg
  if (arg instanceof Error) {
    return arg.stack ? `${arg.name}: ${arg.message}\n${arg.stack}` : `${arg.name}: ${arg.message}`
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2)
    } catch {
      return String(arg)
    }
  }
  return String(arg)
}

function formatArgs(args: unknown[]): string {
  return args.map(formatArg).join(" ")
}

function shouldSkipNetworkUrl(url: string): boolean {
  return (
    url.includes("/_next/") ||
    url.includes("__nextjs_") ||
    url.includes("webpack-hmr") ||
    url.includes("hot-update") ||
    url.startsWith("data:") ||
    url.startsWith("blob:")
  )
}

const FETCH_BODY_PREVIEW_BYTES = 4096

function maskSensitive(name: string, value: string): string {
  const lower = name.toLowerCase()
  if (
    lower === "authorization" ||
    lower === "cookie" ||
    lower === "set-cookie" ||
    lower === "x-api-key" ||
    lower.includes("token")
  ) {
    return "***"
  }
  return value
}

function tryPrettyJson(text: string): string {
  const trimmed = text.trim()
  if (
    !trimmed ||
    !(trimmed.startsWith("{") || trimmed.startsWith("["))
  ) {
    return text
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return text
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "…(truncated)" : text
}

function summarizeRequestBody(init?: RequestInit): string | null {
  const body = init?.body
  if (body == null) return null
  if (typeof body === "string") {
    return truncate(tryPrettyJson(body), FETCH_BODY_PREVIEW_BYTES)
  }
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof FormData) return "<FormData>"
  if (body instanceof Blob) return `<Blob ${body.size}B ${body.type}>`
  if (body instanceof ArrayBuffer)
    return `<ArrayBuffer ${body.byteLength}B>`
  return `<${(body as { constructor?: { name?: string } }).constructor?.name ?? "body"}>`
}

async function readResponseBodyPreview(res: Response): Promise<string | null> {
  try {
    const cloned = res.clone()
    const text = await cloned.text()
    if (!text) return null
    return truncate(tryPrettyJson(text), FETCH_BODY_PREVIEW_BYTES)
  } catch {
    return null
  }
}

function summarizeHeaders(headers?: HeadersInit): string | null {
  if (!headers) return null
  let entries: [string, string][] = []
  if (headers instanceof Headers) {
    headers.forEach((value, key) => entries.push([key, value]))
  } else if (Array.isArray(headers)) {
    entries = headers as [string, string][]
  } else {
    entries = Object.entries(headers as Record<string, string>)
  }
  if (entries.length === 0) return null
  return entries.map(([k, v]) => `${k}: ${maskSensitive(k, v)}`).join("\n")
}

function summarizeResponseHeaders(res: Response): string | null {
  const entries: [string, string][] = []
  res.headers.forEach((value, key) => entries.push([key, value]))
  if (entries.length === 0) return null
  return entries.map(([k, v]) => `${k}: ${maskSensitive(k, v)}`).join("\n")
}

function detectEmbeddedError(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    if (typeof parsed.error === "string" && parsed.error.length > 0) {
      return parsed.error
    }
    if (parsed.ok === false) return "ok: false"
    if (
      parsed.success === false &&
      typeof parsed.message === "string"
    ) {
      return parsed.message
    }
    return null
  } catch {
    return null
  }
}

function instrumentFetch() {
  if (typeof window === "undefined" || !window.fetch) return
  const originalWindowFetch = window.fetch
  const originalFetch = originalWindowFetch.bind(window)
  const wrappedFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    let url: string
    let method: string
    if (typeof input === "string") {
      url = input
      method = init?.method ?? "GET"
    } else if (input instanceof URL) {
      url = input.toString()
      method = init?.method ?? "GET"
    } else {
      url = input.url
      method = init?.method ?? input.method ?? "GET"
    }

    if (shouldSkipNetworkUrl(url)) return originalFetch(input, init)

    const start = performance.now()
    try {
      const res = await originalFetch(input, init)
      const dur = Math.round(performance.now() - start)

      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? ""
        const contentLength = Number.parseInt(
          res.headers.get("content-length") ?? "0",
          10,
        )
        const looksJson = contentType.includes("json")
        const isStream =
          contentType.includes("event-stream") ||
          contentType.includes("octet-stream")
        const reasonableSize =
          !Number.isFinite(contentLength) ||
          contentLength === 0 ||
          contentLength < 64 * 1024

        if (looksJson && !isStream && reasonableSize) {
          const peek = await readResponseBodyPreview(res)
          const embedded = peek ? detectEmbeddedError(peek) : null
          if (embedded) {
            const requestBody = summarizeRequestBody(init)
            const lines: string[] = [
              `[fetch ${res.status} embedded-error] ${method.toUpperCase()} ${url} (${dur}ms): ${embedded}`,
            ]
            if (requestBody) lines.push(`Request body:\n${requestBody}`)
            if (peek) lines.push(`Response body:\n${peek}`)
            pushFrontend("warn", lines.join("\n\n"))
            return res
          }
        }

        pushFrontend(
          "info",
          `[fetch ${res.status}] ${method.toUpperCase()} ${url} (${dur}ms)`,
        )
        return res
      }

      const [responseBody, requestBody, requestHeaders, responseHeaders] =
        await Promise.all([
          readResponseBodyPreview(res),
          Promise.resolve(summarizeRequestBody(init)),
          Promise.resolve(summarizeHeaders(init?.headers)),
          Promise.resolve(summarizeResponseHeaders(res)),
        ])

      const lines: string[] = [
        `[fetch ${res.status} ${res.statusText || "Error"}] ${method.toUpperCase()} ${url} (${dur}ms)`,
      ]
      if (requestHeaders) lines.push(`Request headers:\n${requestHeaders}`)
      if (requestBody) lines.push(`Request body:\n${requestBody}`)
      if (responseHeaders)
        lines.push(`Response headers:\n${responseHeaders}`)
      if (responseBody) lines.push(`Response body:\n${responseBody}`)
      pushFrontend("error", lines.join("\n\n"))
      return res
    } catch (err) {
      const dur = Math.round(performance.now() - start)
      const message = err instanceof Error ? err.message : String(err)
      const stack =
        err instanceof Error && err.stack ? `\nStack:\n${err.stack}` : ""
      const requestBody = summarizeRequestBody(init)
      const requestHeaders = summarizeHeaders(init?.headers)
      const lines: string[] = [
        `[fetch network error] ${method.toUpperCase()} ${url} (${dur}ms): ${message}`,
      ]
      if (requestHeaders) lines.push(`Request headers:\n${requestHeaders}`)
      if (requestBody) lines.push(`Request body:\n${requestBody}`)
      if (stack) lines.push(stack.trimStart())
      pushFrontend("error", lines.join("\n\n"))
      throw err
    }
  }

  Object.assign(wrappedFetch, originalWindowFetch)
  window.fetch = wrappedFetch as typeof window.fetch
}

function instrumentEventSource() {
  if (typeof window === "undefined" || !window.EventSource) return
  const OriginalES = window.EventSource

  class WrappedEventSource extends OriginalES {
    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init)
      const u = url.toString()
      if (shouldSkipNetworkUrl(u)) return
      pushFrontend("info", `[SSE open] ${u}`)
      this.addEventListener("error", () => {
        const state =
          this.readyState === 0
            ? "connecting"
            : this.readyState === 1
              ? "open"
              : "closed"
        pushFrontend("error", `[SSE error] ${u} (state=${state})`)
      })
      this.addEventListener("error_event", (e) => {
        const data = (e as MessageEvent).data
        const text = typeof data === "string" ? data : formatArg(data)
        pushFrontend("error", `[SSE error_event] ${u}\n${text}`)
      })
    }
  }

  window.EventSource = WrappedEventSource as unknown as typeof EventSource
}

function instrumentWebSocket() {
  if (typeof window === "undefined" || !window.WebSocket) return
  const OriginalWS = window.WebSocket

  class WrappedWebSocket extends OriginalWS {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols)
      const u = typeof url === "string" ? url : url.toString()
      pushFrontend("info", `[WS connecting] ${u}`)
      this.addEventListener("open", () => {
        pushFrontend("info", `[WS open] ${u}`)
      })
      this.addEventListener("error", () => {
        pushFrontend("error", `[WS error] ${u}`)
      })
      this.addEventListener("close", (e) => {
        const ce = e as CloseEvent
        const level: LogLevel = ce.wasClean ? "info" : "warn"
        const reason = ce.reason ? `, reason=${ce.reason}` : ""
        pushFrontend(
          level,
          `[WS close] ${u} (code=${ce.code}${reason})`,
        )
      })
    }
  }

  window.WebSocket = WrappedWebSocket as unknown as typeof WebSocket
}

export function initClientLogs() {
  if (initialized) return
  if (typeof window === "undefined") return
  initialized = true

  const original = {
    log: window.console.log.bind(window.console),
    info: window.console.info.bind(window.console),
    warn: window.console.warn.bind(window.console),
    error: window.console.error.bind(window.console),
    debug: window.console.debug.bind(window.console),
  }

  const wrap =
    (level: LogLevel) =>
    (...args: unknown[]) => {
      pushFrontend(level, formatArgs(args))
      original[level](...args)
    }

  window.console.log = wrap("log")
  window.console.info = wrap("info")
  window.console.warn = wrap("warn")
  window.console.error = wrap("error")
  window.console.debug = wrap("debug")

  window.addEventListener("error", (e) => {
    const where = e.filename
      ? ` (${e.filename}:${e.lineno}:${e.colno})`
      : ""
    pushFrontend("error", `Uncaught: ${e.message}${where}`)
  })

  window.addEventListener("unhandledrejection", (e) => {
    pushFrontend("error", `Unhandled rejection: ${formatArg(e.reason)}`)
  })

  instrumentFetch()
  instrumentEventSource()
  instrumentWebSocket()
}

export function getFrontendEntries(): LogEntry[] {
  return buffer.slice()
}

export function subscribeFrontendEntries(
  fn: (entries: LogEntry[]) => void,
): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

export function clearFrontendLogs() {
  buffer = []
  notify()
}

export function parseBackendLog(content: string): LogEntry[] {
  if (!content) return []
  const lines = content.split("\n")
  const entries: LogEntry[] = []
  let local = 0
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line) continue
    local += 1
    const match = line.match(/^\[(\d+)\]\s*(.*)$/)
    let timestamp = Date.now()
    let message = line
    if (match) {
      const ts = Number.parseInt(match[1], 10)
      if (Number.isFinite(ts) && ts > 0) timestamp = ts * 1000
      message = match[2]
    }
    entries.push({
      id: `b-${local}-${timestamp}`,
      timestamp,
      level: inferLevel(message),
      source: "backend",
      message,
    })
  }
  return entries
}

function inferLevel(message: string): LogLevel {
  const lower = message.toLowerCase()
  if (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("fatal") ||
    lower.includes("panic")
  ) {
    return "error"
  }
  if (lower.includes("warn") || lower.includes("warning")) return "warn"
  if (lower.includes("debug")) return "debug"
  return "info"
}

if (typeof window !== "undefined") {
  initClientLogs()
}
