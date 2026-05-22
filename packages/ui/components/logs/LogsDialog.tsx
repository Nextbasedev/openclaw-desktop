"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { Icons } from "@/components/icons"
import {
  clearFrontendLogs,
  getFrontendEntries,
  parseBackendLog,
  subscribeFrontendEntries,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "@/lib/clientLogs"
import { collectDiagnostics } from "@/lib/diagnostics"
import { getMiddlewareConnection, middlewareFetch } from "@/lib/middleware-client"
import { VscOutput, VscRefresh, VscTrash, VscCopy } from "react-icons/vsc"

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  )
}

type SourceFilter = "all" | LogSource

type BackendLogResponse = {
  path: string
  content: string
  size?: number
  truncated?: boolean
  source?: string
  entries?: number
}

function safeLogSource(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return url.replace(/\?.*$/, "")
  }
}

const LEVEL_STYLES: Record<LogLevel, string> = {
  error:
    "border-[#FF4D4D]/30 bg-[#FF4D4D]/10 text-[#FF4D4D]",
  warn: "border-[#FDC700]/30 bg-[#FDC700]/10 text-[#FDC700]",
  info: "border-[#00D492]/30 bg-[#00D492]/10 text-[#00D492]",
  log: "border-white/10 bg-white/4 text-foreground/70",
  debug: "border-white/10 bg-white/4 text-foreground/55",
}

const ALL_LEVELS: LogLevel[] = ["error", "warn", "info", "log", "debug"]

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

export function LogsDialog({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [frontend, setFrontend] = useState<LogEntry[]>(() =>
    getFrontendEntries(),
  )
  const [backend, setBackend] = useState<LogEntry[]>([])
  const [backendPath, setBackendPath] = useState<string | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [backendLoading, setBackendLoading] = useState(false)
  const [copyNotice, setCopyNotice] = useState<string | null>(null)

  const [source, setSource] = useState<SourceFilter>("all")
  const [activeLevels, setActiveLevels] = useState<Set<LogLevel>>(
    () => new Set(ALL_LEVELS),
  )
  const [search, setSearch] = useState("")
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    return subscribeFrontendEntries(setFrontend)
  }, [])

  const loadBackend = useCallback(async (): Promise<LogEntry[]> => {
    setBackendLoading(true)
    setBackendError(null)

    const connection = getMiddlewareConnection()
    if (connection) {
      const sourceLabel = `remote:${safeLogSource(connection.url)}`
      try {
        const res = await middlewareFetch<BackendLogResponse>("/api/logs?limit=1000")
        const entries = parseBackendLog(res.content)
        setBackendPath(`${sourceLabel}/api/logs`)
        setBackend(entries)
        return entries
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setBackendPath(sourceLabel)
        setBackendError(`Remote middleware logs unavailable from ${sourceLabel}: ${message}`)
        setBackend([])
        return []
      } finally {
        setBackendLoading(false)
      }
    }

    if (!isTauriRuntime()) {
      setBackend([])
      setBackendPath(null)
      setBackendError(
        "Backend log file is only available in the desktop app when no remote Middleware is connected.",
      )
      setBackendLoading(false)
      return []
    }
    try {
      const { invoke: tauriInvoke } = await import("@tauri-apps/api/core")
      const res = await tauriInvoke<BackendLogResponse>("read_backend_log")
      const entries = parseBackendLog(res.content)
      setBackendPath(res.path)
      setBackend(entries)
      return entries
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setBackendError(message)
      setBackend([])
      return []
    } finally {
      setBackendLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void loadBackend()
  }, [open, loadBackend])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [open, onClose])

  const merged = useMemo(() => {
    const combined: LogEntry[] = []
    if (source === "all" || source === "frontend") combined.push(...frontend)
    if (source === "all" || source === "backend") combined.push(...backend)
    combined.sort((a, b) => a.timestamp - b.timestamp)
    return combined
  }, [frontend, backend, source])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return merged.filter((e) => {
      if (!activeLevels.has(e.level)) return false
      if (q && !e.message.toLowerCase().includes(q)) return false
      return true
    })
  }, [merged, activeLevels, search])

  useEffect(() => {
    if (!open || !autoScroll) return
    const node = scrollRef.current
    if (!node) return
    requestAnimationFrame(() => {
      node.scrollTop = node.scrollHeight
    })
  }, [filtered, open, autoScroll])

  const toggleLevel = (level: LogLevel) => {
    setActiveLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)
      return next
    })
  }

  const handleCopy = useCallback(async () => {
    const text = filtered
      .map(
        (e) =>
          `${formatTime(e.timestamp)} [${e.level.toUpperCase()}] ${e.source}: ${e.message}`,
      )
      .join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopyNotice(`Copied ${filtered.length} filtered log lines`)
    } catch {
      setCopyNotice("Copy failed")
    }
  }, [filtered])

  const handleCopyDebugBundle = useCallback(async () => {
    const latestBackend = isTauriRuntime() ? await loadBackend() : backend
    const frontendSnapshot = getFrontendEntries()
    const backendSnapshot = latestBackend
    const allEntries = [...frontendSnapshot, ...backendSnapshot].sort((a, b) => a.timestamp - b.timestamp)
    const lastEntries = allEntries.slice(-800)
    const connection = getMiddlewareConnection()
    const activeMiddlewareUrl = connection ? safeLogSource(connection.url) : null
    const activeMiddlewareMode = activeMiddlewareUrl && /^(https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])/i.test(activeMiddlewareUrl)
      ? "local"
      : activeMiddlewareUrl
        ? "remote"
        : null
    const effectiveBackendPath = connection ? `remote:${activeMiddlewareUrl}/api/logs` : backendPath
    const remoteDiagnostics = connection
      ? await middlewareFetch<Record<string, unknown>>("/api/diagnostics", { headers: { "Cache-Control": "no-cache" } }).catch((err) => ({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      }))
      : null
    const metadata = {
      generatedAt: new Date().toISOString(),
      href: typeof window !== "undefined" ? window.location.href : null,
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      activeMiddleware: connection
        ? { mode: activeMiddlewareMode, url: activeMiddlewareUrl, hasToken: Boolean(connection.token) }
        : null,
      backendLogSource: connection ? "remote-middleware" : "local-tauri-log",
      frontendEntries: frontendSnapshot.length,
      backendEntries: backendSnapshot.length,
      backendPath: effectiveBackendPath,
      backendError,
      sourceFilter: source,
      search: search.trim() || null,
    }
    const diagnostics = collectDiagnostics({
      frontendEntries: frontendSnapshot,
      backendEntries: backendSnapshot,
      backendPath: effectiveBackendPath,
      backendError,
      sourceFilter: source,
      search: search.trim() || null,
    })
    const text = [
      "OPENCLAW_DESKTOP_DEBUG_BUNDLE_V1",
      JSON.stringify(metadata, null, 2),
      "--- DIAGNOSTICS ---",
      JSON.stringify(diagnostics, null, 2),
      "--- MIDDLEWARE DIAGNOSTICS ---",
      JSON.stringify(remoteDiagnostics, null, 2),
      "--- LOGS ---",
      ...lastEntries.map(
        (e) =>
          `${new Date(e.timestamp).toISOString()} [${e.level.toUpperCase()}] ${e.source}: ${e.message}`,
      ),
    ].join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopyNotice(`Copied debug bundle (${lastEntries.length} log lines)`)
    } catch {
      setCopyNotice("Debug bundle copy failed")
    }
  }, [backend, backendError, backendPath, loadBackend, search, source])

  const stats = useMemo(() => {
    let errors = 0
    let warns = 0
    for (const e of merged) {
      if (e.level === "error") errors += 1
      else if (e.level === "warn") warns += 1
    }
    return { errors, warns }
  }, [merged])

  if (!open || !mounted) return null

  return createPortal(
    <div
      className="glass-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Application logs"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative flex max-h-[85vh] w-[92vw] max-w-[1100px] flex-col overflow-hidden rounded-2xl",
          "border border-white/8 bg-[#0b0c0f] shadow-[0_24px_64px_rgba(0,0,0,0.55)]",
          "animate-[glass-dialog-in_0.22s_cubic-bezier(0.16,1,0.3,1)]",
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/6 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md border border-white/10 bg-white/4 text-foreground/80">
              <VscOutput className="size-4" />
            </span>
            <div className="flex flex-col">
              <h2 className="text-[14px] font-semibold leading-tight text-foreground">
                Logs
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Combined frontend & backend output
                {backendPath ? ` · ${backendPath}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {stats.errors > 0 && (
              <span className="rounded border border-[#FF4D4D]/30 bg-[#FF4D4D]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FF4D4D]">
                {stats.errors} error{stats.errors === 1 ? "" : "s"}
              </span>
            )}
            {stats.warns > 0 && (
              <span className="rounded border border-[#FDC700]/30 bg-[#FDC700]/10 px-2 py-0.5 text-[10px] font-semibold text-[#FDC700]">
                {stats.warns} warn{stats.warns === 1 ? "" : "s"}
              </span>
            )}
            <button
              onClick={onClose}
              aria-label="Close logs"
              className="ml-1 flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground cursor-pointer"
            >
              <Icons.Close size={14} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-white/6 px-5 py-3">
          <div className="flex rounded-md border border-white/8 bg-white/2 p-0.5">
            {(["all", "frontend", "backend"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setSource(opt)}
                className={cn(
                  "rounded px-2.5 py-1 text-[11px] font-medium capitalize transition-colors cursor-pointer",
                  source === opt
                    ? "bg-white/8 text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            {ALL_LEVELS.map((level) => {
              const active = activeLevels.has(level)
              return (
                <button
                  key={level}
                  onClick={() => toggleLevel(level)}
                  className={cn(
                    "rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-all cursor-pointer",
                    active
                      ? LEVEL_STYLES[level]
                      : "border-white/8 bg-transparent text-muted-foreground/50 hover:text-muted-foreground",
                  )}
                >
                  {level}
                </button>
              )
            })}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="w-44 rounded-md border border-white/8 bg-white/2 px-2.5 py-1 text-[12px] text-foreground placeholder:text-muted-foreground/50 focus:border-white/20 focus:outline-none"
              />
            </div>
            <button
              onClick={loadBackend}
              disabled={backendLoading}
              title="Refresh backend log"
              className="flex size-7 items-center justify-center rounded-md border border-white/8 bg-white/2 text-muted-foreground transition-colors hover:bg-white/6 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
              <VscRefresh
                className={cn("size-3.5", backendLoading && "animate-spin")}
              />
            </button>
            <button
              onClick={handleCopyDebugBundle}
              title="Copy debug bundle for Cozy"
              className="flex items-center gap-1.5 rounded-md border border-[#00D492]/25 bg-[#00D492]/10 px-2.5 py-1 text-[11px] font-medium text-[#00D492] transition-colors hover:bg-[#00D492]/15 cursor-pointer"
            >
              <VscCopy className="size-3.5" />
              Copy debug bundle
            </button>
            <button
              onClick={handleCopy}
              title="Copy filtered logs"
              className="flex size-7 items-center justify-center rounded-md border border-white/8 bg-white/2 text-muted-foreground transition-colors hover:bg-white/6 hover:text-foreground cursor-pointer"
            >
              <VscCopy className="size-3.5" />
            </button>
            <button
              onClick={clearFrontendLogs}
              title="Clear frontend buffer"
              className="flex size-7 items-center justify-center rounded-md border border-white/8 bg-white/2 text-muted-foreground transition-colors hover:bg-white/6 hover:text-foreground cursor-pointer"
            >
              <VscTrash className="size-3.5" />
            </button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto bg-[#0a0b0d] font-mono text-[12px] leading-relaxed"
        >
          {backendError && (
            <div className="border-b border-[#FF4D4D]/20 bg-[#FF4D4D]/5 px-5 py-2 text-[11px] text-[#FF4D4D]">
              Backend log: {backendError}
            </div>
          )}
          {filtered.length === 0 ? (
            <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
              <VscOutput className="size-5 text-muted-foreground/40" />
              <p className="text-[12px] text-muted-foreground">
                {merged.length === 0
                  ? "No logs captured yet"
                  : "No entries match the current filters"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-white/4">
              {filtered.map((entry) => (
                <LogRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/6 px-5 py-2.5 text-[11px] text-muted-foreground">
          <label className="flex cursor-pointer select-none items-center gap-2">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="size-3 cursor-pointer accent-foreground"
            />
            Auto-scroll
          </label>
          <div className="flex items-center gap-3">
            {copyNotice && <span className="text-[#00D492]">{copyNotice}</span>}
            <span className="tabular-nums">
              {filtered.length} / {merged.length} entries
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function LogRow({ entry }: { entry: LogEntry }) {
  return (
    <div className="flex items-start gap-3 px-5 py-1.5 hover:bg-white/2">
      <span className="shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground/60">
        {formatTime(entry.timestamp)}
      </span>
      <span
        className={cn(
          "shrink-0 rounded border px-1.5 py-0 text-[10px] font-semibold uppercase tracking-wide",
          LEVEL_STYLES[entry.level],
        )}
      >
        {entry.level}
      </span>
      <span
        className={cn(
          "shrink-0 rounded border border-white/10 bg-white/2 px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70",
        )}
      >
        {entry.source}
      </span>
      <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/85">
        {entry.message}
      </pre>
    </div>
  )
}
