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

export type FrontendLogCategory =
  | "api"
  | "connection"
  | "session"
  | "chat"
  | "composer"
  | "stream"
  | "status"
  | "ui"
  | "runtime"
  | "scheduler"

export type FrontendLogContext = Record<string, unknown>

const MAX_ENTRIES = 1000
const SECRET_VALUE = "[redacted]"
const OMITTED_VALUE = "[omitted]"
const MAX_STRING_CHARS = 300
const MAX_ARRAY_ITEMS = 20
const MAX_OBJECT_KEYS = 40

let buffer: LogEntry[] = []
const subscribers = new Set<(entries: LogEntry[]) => void>()
let initialized = false
let counter = 0
let fetchCounter = 0
let originalConsole: Record<LogLevel, (...args: unknown[]) => void> | null = null

let notifyScheduled = false
function notify() {
  if (notifyScheduled) return
  notifyScheduled = true
  const flush = () => {
    notifyScheduled = false
    const snapshot = buffer.slice()
    subscribers.forEach((fn) => fn(snapshot))
  }
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(flush)
  else setTimeout(flush, 0)
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

function isSensitiveKey(key: string) {
  const lower = key.toLowerCase()
  return (
    lower === "authorization" ||
    lower === "cookie" ||
    lower === "set-cookie" ||
    lower.startsWith("tauri-") ||
    lower.includes("invoke-key") ||
    lower === "x-api-key" ||
    lower === "api-key" ||
    lower === "password" ||
    lower === "secret" ||
    lower === "token" ||
    lower === "middlewaretoken" ||
    lower === "middleware-token" ||
    lower.includes("token") ||
    lower.includes("secret") ||
    lower.includes("password") ||
    lower.includes("credential") ||
    lower.includes("cookie")
  )
}

function isContentKey(key: string) {
  const lower = key.toLowerCase()
  return (
    lower === "text" ||
    lower === "content" ||
    lower === "message" ||
    lower === "body" ||
    lower === "prompt" ||
    lower === "transcript" ||
    lower === "snippet" ||
    lower === "free_text" ||
    lower === "freetext"
  )
}

export function redactText(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/(authorization\s*[:=]\s*)[^\s,;]+/gi, `$1${SECRET_VALUE}`)
    .replace(/(cookie\s*[:=]\s*)[^\n]+/gi, `$1${SECRET_VALUE}`)
    .replace(/([?&](?:token|key|code|secret|password|auth|session)[^=]*=)[^&\s]+/gi, `$1${SECRET_VALUE}`)
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, SECRET_VALUE)
    .replace(/(ghp_[A-Za-z0-9_]+)/g, SECRET_VALUE)
}

function truncate(text: string, max = MAX_STRING_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…(truncated)` : text
}

function looksLikeFileMetadata(value: Record<string, unknown>) {
  return (
    typeof value.name === "string" &&
    (typeof value.mimeType === "string" || typeof value.type === "string" || typeof value.size === "number")
  )
}

function sanitizeFileMetadata(value: Record<string, unknown>) {
  return {
    name: typeof value.name === "string" ? truncate(value.name, 120) : undefined,
    type:
      typeof value.mimeType === "string"
        ? value.mimeType
        : typeof value.type === "string"
          ? value.type
          : undefined,
    size: typeof value.size === "number" ? value.size : undefined,
  }
}

export function sanitizeForLog(value: unknown, key = "", depth = 0): unknown {
  if (isSensitiveKey(key)) return SECRET_VALUE
  if (isContentKey(key)) return OMITTED_VALUE
  if (value == null) return value
  if (typeof value === "string") return truncate(redactText(value))
  if (typeof value === "number" || typeof value === "boolean") return value
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(redactText(value.message)),
    }
  }
  if (typeof File !== "undefined" && value instanceof File) {
    return { name: value.name, type: value.type, size: value.size }
  }
  if (typeof Blob !== "undefined" && value instanceof Blob) {
    return { type: value.type, size: value.size }
  }
  if (value instanceof ArrayBuffer) return { type: "ArrayBuffer", size: value.byteLength }
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeForLog(item, key, depth + 1))
    if (value.length > MAX_ARRAY_ITEMS) items.push(`…${value.length - MAX_ARRAY_ITEMS} more`)
    return items
  }
  if (typeof value === "object") {
    if (depth >= 3) return `[${(value as { constructor?: { name?: string } }).constructor?.name ?? "object"}]`
    const record = value as Record<string, unknown>
    if (looksLikeFileMetadata(record)) return sanitizeFileMetadata(record)
    const out: Record<string, unknown> = {}
    const entries = Object.entries(record).slice(0, MAX_OBJECT_KEYS)
    for (const [childKey, childValue] of entries) {
      out[childKey] = sanitizeForLog(childValue, childKey, depth + 1)
    }
    if (Object.keys(record).length > MAX_OBJECT_KEYS) out.__truncatedKeys = Object.keys(record).length - MAX_OBJECT_KEYS
    return out
  }
  return String(value)
}

export function sanitizeUrlForLog(rawUrl: string): string {
  const safeRaw = redactText(rawUrl)
  try {
    const url = new URL(safeRaw, typeof window !== "undefined" ? window.location.href : "http://localhost")
    const queryKeys = Array.from(url.searchParams.keys()).filter((key) => !isSensitiveKey(key))
    const querySuffix = queryKeys.length > 0 ? `?${queryKeys.map((key) => `${key}=…`).join("&")}` : ""
    return `${url.origin}${url.pathname}${querySuffix}`
  } catch {
    const [path] = safeRaw.split("?")
    return path || "[invalid-url]"
  }
}

function formatContext(context?: FrontendLogContext): string {
  if (!context || Object.keys(context).length === 0) return ""
  try {
    return ` ${JSON.stringify(sanitizeForLog(context))}`
  } catch {
    return ""
  }
}

export function frontendLog(
  category: FrontendLogCategory,
  event: string,
  context?: FrontendLogContext,
  level: LogLevel = "info",
) {
  const message = `[OpenClaw frontend:${category}] ${event}${formatContext(context)}`
  pushFrontend(level, message)
  const writer = originalConsole?.[level] ?? (typeof console !== "undefined" ? console[level] : null)
  if (writer) writer(message)
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return truncate(redactText(arg), 2000)
  if (arg instanceof Error) {
    const message = `${arg.name}: ${redactText(arg.message)}`
    return arg.stack ? truncate(redactText(`${message}\n${arg.stack}`), 4000) : message
  }
  if (typeof arg === "object" && arg !== null) {
    try {
      return JSON.stringify(sanitizeForLog(arg), null, 2)
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

function summarizeRequestHeaders(headers?: HeadersInit): Record<string, string> | undefined {
  if (!headers) return undefined
  let entries: [string, string][] = []
  if (headers instanceof Headers) {
    headers.forEach((value, key) => entries.push([key, value]))
  } else if (Array.isArray(headers)) {
    entries = headers as [string, string][]
  } else {
    entries = Object.entries(headers as Record<string, string>)
  }
  if (entries.length === 0) return undefined
  const out: Record<string, string> = {}
  for (const [key, value] of entries) out[key] = isSensitiveKey(key) ? SECRET_VALUE : truncate(redactText(String(value)), 120)
  return out
}

function summarizeBody(body: BodyInit | null | undefined): unknown {
  if (body == null) return undefined
  if (typeof body === "string") {
    try {
      const parsed = JSON.parse(body)
      return { type: "json", shape: sanitizeForLog(parsed) }
    } catch {
      return { type: "text", length: body.length, preview: OMITTED_VALUE }
    }
  }
  if (body instanceof URLSearchParams) return { type: "URLSearchParams", keys: Array.from(body.keys()).filter((key) => !isSensitiveKey(key)) }
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    const fields: Array<Record<string, unknown>> = []
    body.forEach((value, key) => {
      if (isSensitiveKey(key) || isContentKey(key)) fields.push({ key, value: isSensitiveKey(key) ? SECRET_VALUE : OMITTED_VALUE })
      else fields.push({ key, value: sanitizeForLog(value, key) })
    })
    return { type: "FormData", fields }
  }
  if (typeof Blob !== "undefined" && body instanceof Blob) return { type: "Blob", size: body.size, mimeType: body.type }
  if (body instanceof ArrayBuffer) return { type: "ArrayBuffer", size: body.byteLength }
  return { type: (body as { constructor?: { name?: string } }).constructor?.name ?? "body" }
}

function responseMeta(res: Response) {
  return {
    status: res.status,
    statusText: res.statusText || undefined,
    contentType: res.headers.get("content-type") ?? undefined,
    contentLength: res.headers.get("content-length") ?? undefined,
  }
}

function errorMeta(error: unknown) {
  if (error instanceof DOMException) {
    return { kind: error.name, message: redactText(error.message) }
  }
  if (error instanceof Error) {
    return { kind: error.name || "Error", message: redactText(error.message) }
  }
  return { kind: "Error", message: redactText(String(error)) }
}

function eventSourceStateLabel(readyState: number): "connecting" | "open" | "closed" {
  return readyState === 0
    ? "connecting"
    : readyState === 1
      ? "open"
      : "closed"
}

function isOptionalSseStream(url?: string): boolean {
  if (!url) return false
  return url.includes("/api/stream/cron")
}

function eventSourceErrorLevel(
  readyState: number,
  closeRequested: boolean,
  hasOpened: boolean,
  url?: string,
): LogLevel {
  if (closeRequested) return "debug"
  if (readyState === 2 && !hasOpened && isOptionalSseStream(url)) return "warn"
  if (readyState === 2) return hasOpened ? "warn" : "error"
  return hasOpened ? "info" : "warn"
}

function eventSourceEventName(
  readyState: number,
  closeRequested: boolean,
  hasOpened: boolean,
  url?: string,
): "sse.error" | "sse.disconnected" | "sse.retrying" | "sse.closed" | "sse.unavailable" {
  if (closeRequested) return "sse.closed"
  if (readyState === 2 && !hasOpened && isOptionalSseStream(url)) {
    return "sse.unavailable"
  }
  if (readyState === 2) return hasOpened ? "sse.disconnected" : "sse.error"
  return "sse.retrying"
}

function requestMeta(input: RequestInfo | URL, init?: RequestInit) {
  let url: string
  let method: string
  let requestHeaders: HeadersInit | undefined
  if (typeof input === "string") {
    url = input
    method = init?.method ?? "GET"
    requestHeaders = init?.headers
  } else if (input instanceof URL) {
    url = input.toString()
    method = init?.method ?? "GET"
    requestHeaders = init?.headers
  } else {
    url = input.url
    method = init?.method ?? input.method ?? "GET"
    requestHeaders = init?.headers ?? input.headers
  }
  return {
    url,
    safeUrl: sanitizeUrlForLog(url),
    method: method.toUpperCase(),
    headers: summarizeRequestHeaders(requestHeaders),
    body: summarizeBody(init?.body ?? null),
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
    const meta = requestMeta(input, init)
    if (shouldSkipNetworkUrl(meta.url)) return originalFetch(input, init)

    fetchCounter += 1
    const requestId = `req-${fetchCounter}`
    const start = performance.now()
    frontendLog("api", "request.start", {
      requestId,
      method: meta.method,
      url: meta.safeUrl,
      headers: meta.headers,
      body: meta.body,
    }, "debug")

    try {
      const res = await originalFetch(input, init)
      const durationMs = Math.round(performance.now() - start)
      const level: LogLevel = res.ok ? "info" : "error"
      frontendLog("api", res.ok ? "request.end" : "request.fail", {
        requestId,
        method: meta.method,
        url: meta.safeUrl,
        durationMs,
        ...responseMeta(res),
      }, level)
      return res
    } catch (err) {
      const durationMs = Math.round(performance.now() - start)
      const isAbort = err instanceof DOMException && err.name === "AbortError"
      frontendLog("api", isAbort ? "request.abort" : "request.fail", {
        requestId,
        method: meta.method,
        url: meta.safeUrl,
        durationMs,
        error: errorMeta(err),
      }, isAbort ? "debug" : "error")
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
    private __closeRequested = false
    private __hasOpened = false

    constructor(url: string | URL, init?: EventSourceInit) {
      super(url, init)
      const safeUrl = sanitizeUrlForLog(url.toString())
      if (shouldSkipNetworkUrl(url.toString())) return
      frontendLog("stream", "sse.open", { url: safeUrl, withCredentials: init?.withCredentials ?? false })
      this.addEventListener("open", () => {
        this.__hasOpened = true
        frontendLog("stream", "sse.ready", { url: safeUrl }, "debug")
      })
      this.addEventListener("error", () => {
        const state = eventSourceStateLabel(this.readyState)
        frontendLog(
          "stream",
          eventSourceEventName(
            this.readyState,
            this.__closeRequested,
            this.__hasOpened,
            safeUrl,
          ),
          { url: safeUrl, readyState: state },
          eventSourceErrorLevel(
            this.readyState,
            this.__closeRequested,
            this.__hasOpened,
            safeUrl,
          ),
        )
      })
      this.addEventListener("error_event", (e) => {
        const data = (e as MessageEvent).data
        frontendLog("stream", "sse.error_event", { url: safeUrl, data: sanitizeForLog(data) }, "error")
      })
    }

    override close(): void {
      this.__closeRequested = true
      return super.close()
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
      const safeUrl = sanitizeUrlForLog(typeof url === "string" ? url : url.toString())
      frontendLog("stream", "ws.connect.start", { url: safeUrl, protocols: Array.isArray(protocols) ? protocols.length : protocols ? 1 : 0 })
      this.addEventListener("open", () => {
        frontendLog("stream", "ws.connect.success", { url: safeUrl })
      })
      this.addEventListener("error", () => {
        frontendLog("stream", "ws.connect.fail", { url: safeUrl }, "error")
      })
      this.addEventListener("close", (e) => {
        const ce = e as CloseEvent
        frontendLog("stream", "ws.disconnect", {
          url: safeUrl,
          code: ce.code,
          clean: ce.wasClean,
          reason: ce.reason ? redactText(ce.reason) : undefined,
        }, ce.wasClean ? "info" : "warn")
      })
    }
  }

  window.WebSocket = WrappedWebSocket as unknown as typeof WebSocket
}

export function initClientLogs() {
  if (initialized) return
  if (typeof window === "undefined") return
  initialized = true

  originalConsole = {
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
      originalConsole?.[level](...args)
    }

  window.console.log = wrap("log")
  window.console.info = wrap("info")
  window.console.warn = wrap("warn")
  window.console.error = wrap("error")
  window.console.debug = wrap("debug")

  if (typeof window.addEventListener === "function") {
    window.addEventListener("error", (e) => {
      const where = e.filename
        ? ` (${sanitizeUrlForLog(e.filename)}:${e.lineno}:${e.colno})`
        : ""
      frontendLog("runtime", "window.error", { message: e.message, where }, "error")
    })

    window.addEventListener("unhandledrejection", (e) => {
      frontendLog("runtime", "unhandledrejection", { reason: e.reason }, "error")
    })
  }

  frontendLog("runtime", "client-logs.initialized", { href: sanitizeUrlForLog(window.location?.href ?? "unknown") }, "debug")
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
      message: redactText(message),
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

export const __clientLogsForTests = {
  requestMeta,
  summarizeBody,
  errorMeta,
  pushFrontend,
  isOptionalSseStream,
  eventSourceStateLabel,
  eventSourceErrorLevel,
  eventSourceEventName,
}

if (typeof window !== "undefined") {
  initClientLogs()
}
