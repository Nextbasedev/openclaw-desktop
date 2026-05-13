import { useRef, useCallback } from "react"
import type { Terminal } from "@xterm/xterm"
import { invoke, openEventStream } from "@/lib/ipc"
import { getMiddlewareConnection } from "@/lib/middleware-client"

type PtyEventPayload = {
  type: "pty.data" | "pty.exit" | "pty.error" | "terminal.data" | "terminal.exit" | "terminal.error"
  ptyId?: string
  terminalId?: string
  data?: string
  message?: string
}

type SpawnResult = { ptyId: string; cwd: string; websocketUrl?: string }

type PtyEventResult = { wroteOutput: boolean }

function handleEvent(
  evt: PtyEventPayload,
  termRef: React.RefObject<Terminal | null>,
): PtyEventResult {
  if ((evt.type === "pty.data" || evt.type === "terminal.data") && evt.data) {
    termRef.current?.write(evt.data)
    return { wroteOutput: true }
  } else if (evt.type === "pty.exit" || evt.type === "terminal.exit") {
    termRef.current?.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n")
    return { wroteOutput: true }
  } else if ((evt.type === "pty.error" || evt.type === "terminal.error") && evt.message) {
    termRef.current?.write(`\r\n\x1b[31m[error: ${evt.message}]\x1b[0m\r\n`)
    return { wroteOutput: true }
  }
  return { wroteOutput: false }
}

function echoCompatInput(term: Terminal | null, data: string) {
  if (!term) return
  if (data === "\x7f") {
    term.write("\b \b")
    return
  }
  if (data === "\r" || data === "\n" || data === "\r\n") {
    term.write("\r\n")
    return
  }
  if (data.startsWith("\x1b")) return
  term.write(data.replace(/\r?\n/g, "\r\n"))
}

function middlewareWsUrl(path: string | undefined): string | null {
  if (!path) return null
  const connection = getMiddlewareConnection()
  if (!connection) return null
  const base = connection.url.replace(/\/+$/, "").replace(/^http:/, "ws:").replace(/^https:/, "wss:")
  return `${base}${path}?token=${encodeURIComponent(connection.token)}`
}

export function usePty(
  termRef: React.RefObject<Terminal | null>,
  projectId?: string | null,
) {
  const ptyIdRef = useRef<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const closeStreamRef = useRef<(() => void) | null>(null)
  const outputSeenRef = useRef(false)
  const compatEchoRef = useRef(false)
  const promptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPromptTimer = useCallback(() => {
    if (promptTimerRef.current) clearTimeout(promptTimerRef.current)
    promptTimerRef.current = null
  }, [])

  const scheduleCompatPrompt = useCallback((delayMs = 90) => {
    if (!compatEchoRef.current) return
    clearPromptTimer()
    promptTimerRef.current = setTimeout(() => {
      promptTimerRef.current = null
      if (ptyIdRef.current) termRef.current?.write("\r\n$ ")
    }, delayMs)
  }, [clearPromptTimer, termRef])

  const cleanup = useCallback(() => {
    clearPromptTimer()
    wsRef.current?.close()
    wsRef.current = null
    closeStreamRef.current?.()
    closeStreamRef.current = null
    compatEchoRef.current = false
    outputSeenRef.current = false
    if (ptyIdRef.current) {
      const id = ptyIdRef.current
      ptyIdRef.current = null
      invoke("middleware_pty_kill", { input: { ptyId: id } }).catch(() => {})
    }
  }, [clearPromptTimer])

  const spawn = useCallback(
    async (rows: number, cols: number, signal: { aborted: boolean }) => {
      cleanup()

      if (signal.aborted) return { ptyId: "", cwd: "" } as SpawnResult

      const result = await invoke<SpawnResult>("middleware_pty_spawn", {
        input: { rows, cols, projectId: projectId ?? undefined },
      })

      if (signal.aborted) {
        invoke("middleware_pty_kill", { input: { ptyId: result.ptyId } }).catch(() => {})
        return result
      }

      ptyIdRef.current = result.ptyId
      setTimeout(() => {
        if (signal.aborted || outputSeenRef.current || !ptyIdRef.current) return
        compatEchoRef.current = true
        termRef.current?.write(`\x1b[90m${result.cwd}\x1b[0m\r\n$ `)
      }, 800)

      const wsUrl = middlewareWsUrl(result.websocketUrl)
      if (wsUrl) {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as { data?: unknown } | PtyEventPayload
            const evt = typeof payload === "object" && payload && "data" in payload && typeof payload.data === "object" && payload.data
              ? payload.data as PtyEventPayload
              : payload as PtyEventPayload
            const result = handleEvent(evt, termRef)
            if (result.wroteOutput) {
              outputSeenRef.current = true
              scheduleCompatPrompt()
            }
          } catch {}
        }
        ws.onerror = () => {
          termRef.current?.write("\r\n\x1b[33m[websocket terminal stream unavailable, falling back may require reload]\x1b[0m\r\n")
        }
      } else {
        closeStreamRef.current = openEventStream(
          `/api/stream/pty/${result.ptyId}`,
          (event) => {
            try {
              const data = JSON.parse(event.data) as PtyEventPayload | { event: PtyEventPayload }
              const evt = "event" in data ? data.event : data
              const result = handleEvent(evt, termRef)
              if (result.wroteOutput) {
                outputSeenRef.current = true
                scheduleCompatPrompt()
              }
            } catch {}
          },
        )
      }

      return result
    },
    [termRef, cleanup, projectId, scheduleCompatPrompt],
  )

  const write = useCallback(async (data: string) => {
    if (!ptyIdRef.current) return
    if (compatEchoRef.current) {
      clearPromptTimer()
      echoCompatInput(termRef.current, data)
      if (data.includes("\r") || data.includes("\n")) scheduleCompatPrompt(650)
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "write", data }))
      return
    }
    await invoke("middleware_pty_write", {
      input: { ptyId: ptyIdRef.current, data },
    })
  }, [clearPromptTimer, scheduleCompatPrompt, termRef])

  const resize = useCallback(async (rows: number, cols: number) => {
    if (!ptyIdRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "resize", rows, cols }))
      return
    }
    await invoke("middleware_pty_resize", {
      input: { ptyId: ptyIdRef.current, rows, cols },
    })
  }, [])

  return { spawn, write, resize, cleanup }
}
