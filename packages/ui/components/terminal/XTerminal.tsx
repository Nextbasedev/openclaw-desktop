"use client"

import { useRef, useEffect } from "react"
import { Terminal, type ITheme } from "@xterm/xterm"
import { FitAddon } from "@xterm/addon-fit"
import { useTheme } from "next-themes"
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

interface XTerminalProps {
  visible: boolean
}

export function XTerminal({ visible }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const { resolvedTheme } = useTheme()

  const pty = usePty(termRef)
  const ptyRef = useRef(pty)
  ptyRef.current = pty

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

    requestAnimationFrame(() => {
      fit.fit()
      term.focus()
    })

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

    const { rows, cols } = term
    ptyRef.current.spawn(rows, cols, signal).catch((err) => {
      if (signal.aborted) return
      term.writeln(`\x1b[31mFailed to spawn shell: ${String(err)}\x1b[0m`)
      term.writeln("\x1b[90mMake sure the backend server is running (pnpm --filter server dev)\x1b[0m")
    })

    const ro = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        try { fit.fit() } catch { }
      })
    })
    ro.observe(container)

    return () => {
      signal.aborted = true
      container.removeEventListener("paste", onPaste)
      ro.disconnect()
      term.dispose()
      termRef.current = null
      fitRef.current = null
      ptyRef.current.cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        } catch { }
      })
    }
  }, [visible])

  return (
    <div
      ref={containerRef}
      className="size-full bg-white p-1 dark:bg-black"
      onClick={() => termRef.current?.focus()}
    />
  )
}
