"use client"

import { useRef, useEffect, useState } from "react"
import { Terminal, type ITheme } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { useTheme } from "next-themes"
import { LuClipboard, LuCheck, LuRefreshCw, LuTrash2 } from "react-icons/lu"
import { cn } from "@/lib/utils"
import { usePty } from "./usePty"

const DARK_THEME: ITheme = {
  background: "#000000",
  foreground: "#fafafa",
  cursor: "#fafafa",
  cursorAccent: "#000000",
  selectionBackground: "rgba(255,255,255,0.15)",
  black: "#1a1a2e",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#fafafa",
  brightBlack: "#6b7280",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#ffffff",
}

const LIGHT_THEME: ITheme = {
  background: "#ffffff",
  foreground: "#1a1a2e",
  cursor: "#1a1a2e",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(0,0,0,0.12)",
  black: "#1a1a2e",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#ca8a04",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#fafafa",
  brightBlack: "#6b7280",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
}

function getTermTheme(resolved: string | undefined): ITheme {
  return resolved === "dark" ? DARK_THEME : LIGHT_THEME
}

function terminalStatusLabel(status: string) {
  switch (status) {
    case "spawning": return "Starting"
    case "connected": return "Connected"
    case "stream_failed": return "SSE fallback"
    case "exited": return "Exited"
    case "error": return "Error"
    default: return "Idle"
  }
}

function terminalStatusClass(status: string) {
  switch (status) {
    case "connected": return "border-emerald-400/20 bg-emerald-400/10 text-emerald-300"
    case "spawning": return "border-amber-400/20 bg-amber-400/10 text-amber-300"
    case "stream_failed": return "border-sky-400/20 bg-sky-400/10 text-sky-300"
    case "error": return "border-red-400/20 bg-red-400/10 text-red-300"
    case "exited": return "border-white/10 bg-white/[0.045] text-white/45"
    default: return "border-white/10 bg-white/[0.04] text-white/45"
  }
}

function compactPath(path: string | null) {
  if (!path) return "Workspace terminal"
  const home = typeof window === "undefined" ? path : path.replace(/^\/root\/\.openclaw\/workspace/, "~/workspace")
  if (home.length <= 58) return home
  const parts = home.split("/").filter(Boolean)
  return parts.length > 2 ? `…/${parts.slice(-2).join("/")}` : `…${home.slice(-55)}`
}

interface XTerminalProps {
  visible: boolean
  projectId?: string | null
}

export function XTerminal({ visible, projectId }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const spawnRef = useRef<(() => void) | null>(null)
  const spawnedRef = useRef(false)
  const visibleRef = useRef(visible)
  const { resolvedTheme } = useTheme()
  const [copied, setCopied] = useState(false)

  const pty = usePty(termRef, projectId)
  const ptyRef = useRef(pty)
  ptyRef.current = pty

  function terminalTextForCopy(term: Terminal) {
    const selection = term.getSelection()
    if (selection) return selection
    const buffer = term.buffer.active
    const lines: string[] = []
    const start = Math.max(0, buffer.baseY)
    const end = Math.min(buffer.length, buffer.baseY + term.rows)
    for (let i = start; i < end; i += 1) {
      lines.push(buffer.getLine(i)?.translateToString(true) ?? "")
    }
    return lines.join("\n").trimEnd()
  }

  function copyTerminal() {
    const term = termRef.current
    if (!term) return
    const text = terminalTextForCopy(term)
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    }).catch(() => {})
  }

  function clearTerminal() {
    termRef.current?.clear()
    termRef.current?.focus()
  }

  function reconnectTerminal() {
    const term = termRef.current
    if (!term || ptyRef.current.status === "spawning") return
    ptyRef.current.cleanup()
    spawnedRef.current = false
    term.reset()
    term.writeln("\x1b[90m[reconnecting terminal...]\x1b[0m")
    requestAnimationFrame(() => spawnRef.current?.())
  }

  useEffect(() => {
    visibleRef.current = visible
  }, [visible])

  useEffect(() => {
    if (!containerRef.current) return

    const signal = { aborted: false }

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Fira Code', Menlo, monospace",
      lineHeight: 1.35,
      scrollback: 5000,
      theme: getTermTheme(resolvedTheme),
    })

    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    termRef.current = term
    fitRef.current = fit

    term.onData((data) => ptyRef.current.write(data))
    term.onResize(({ rows, cols }) => ptyRef.current.resize(rows, cols))

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.code === "KeyC" && term.hasSelection()) {
        navigator.clipboard.writeText(term.getSelection()).catch(() => { })
        return false
      }
      if (mod && e.code === "KeyV") {
        return false
      }
      return true
    })

    const container = containerRef.current
    function onPaste(e: ClipboardEvent) {
      e.preventDefault()
      const text = e.clipboardData?.getData("text")
      if (text) ptyRef.current.write(text)
    }
    container.addEventListener("paste", onPaste)

    spawnRef.current = () => {
      if (signal.aborted) return
      if (spawnedRef.current) return
      if (!visibleRef.current) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      spawnedRef.current = true
      requestAnimationFrame(() => {
        if (signal.aborted) return
        if (!visibleRef.current) {
          spawnedRef.current = false
          return
        }
        const nextRect = container.getBoundingClientRect()
        if (nextRect.width <= 0 || nextRect.height <= 0) {
          spawnedRef.current = false
          return
        }
        fit.fit()
        term.focus()
        const { rows, cols } = term
        ptyRef.current.spawn(rows, cols, signal).catch((err) => {
          if (signal.aborted) return
          const message = err instanceof Error ? err.message : String(err)
          term.writeln(`\x1b[31mFailed to open terminal: ${message}\x1b[0m`)
          term.writeln("\x1b[90mCheck that OpenClaw Middleware is connected and the selected workspace still exists.\x1b[0m")
        })
      })
    }

    document.fonts.ready.then(() => {
      if (signal.aborted) return
      if (visibleRef.current) spawnRef.current?.()
    })

    const ro = new ResizeObserver(() => {
      if (!visibleRef.current) return
      requestAnimationFrame(() => {
        if (!visibleRef.current) return
        const rect = container.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return
        try { fit.fit() } catch { }
      })
    })
    ro.observe(container)

    return () => {
      signal.aborted = true
      container.removeEventListener("paste", onPaste)
      ro.disconnect()
      spawnRef.current = null
      spawnedRef.current = false
      term.dispose()
      termRef.current = null
      fitRef.current = null
      ptyRef.current.cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId])

  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = getTermTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    if (visible && fitRef.current && termRef.current) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
          termRef.current?.focus()
          spawnRef.current?.()
        } catch { }
      })
    }
  }, [visible])

  return (
    <div className="flex size-full flex-col overflow-hidden rounded-xl border border-white/[0.08] bg-[#050505] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-white/[0.07] bg-white/[0.025] px-3">
        <div className="min-w-0 flex items-center gap-2">
          <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-white/[0.07] text-[10px] font-semibold text-white/55">
            $
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-medium leading-4 text-white/82">Terminal</div>
            <div className="truncate text-[10.5px] leading-3 text-white/35" title={pty.cwd ?? undefined}>{compactPath(pty.cwd)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn("rounded-full border px-2 py-0.5 text-[10.5px] font-medium", terminalStatusClass(pty.status))} title={pty.statusMessage}>
            {terminalStatusLabel(pty.status)}
          </span>
          <button type="button" onClick={copyTerminal} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80" aria-label="Copy terminal output">
            {copied ? <LuCheck size={14} /> : <LuClipboard size={14} />}
          </button>
          <button type="button" onClick={clearTerminal} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80" aria-label="Clear terminal display">
            <LuTrash2 size={14} />
          </button>
          <button type="button" onClick={reconnectTerminal} disabled={pty.status === "spawning"} className="flex size-7 cursor-pointer items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.07] hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-35" aria-label="Reconnect terminal">
            <LuRefreshCw size={14} />
          </button>
        </div>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 bg-[#050505] p-2"
        onClick={() => termRef.current?.focus()}
      />
    </div>
  )
}
