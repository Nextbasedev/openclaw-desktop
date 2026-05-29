import { useRef, useCallback, useState } from "react"
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
export type PtyStatus = "idle" | "spawning" | "connected" | "stream_failed" | "exited" | "error"

function handleEvent(
  evt: PtyEventPayload,
  termRef: React.RefObject<Terminal | null>,
) {
  if ((evt.type === "pty.data" || evt.type === "terminal.data") && evt.data) {
    termRef.current?.write(evt.data)
  } else if (evt.type === "pty.exit" || evt.type === "terminal.exit") {
    termRef.current?.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n")
  } else if ((evt.type === "pty.error" || evt.type === "terminal.error") && evt.message) {
    termRef.current?.write(`\r\n\x1b[31m[error: ${evt.message}]\x1b[0m\r\n`)
  }
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
  onStatus?: (status: PtyStatus, message?: string) => void,
) {
  const ptyIdRef = useRef<string | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const closeStreamRef = useRef<(() => void) | null>(null)
  const writeQueueRef = useRef<string[]>([])
  const [status, setStatusState] = useState<PtyStatus>("idle")
  const [statusMessage, setStatusMessage] = useState<string | undefined>()
  const [cwd, setCwd] = useState<string | null>(null)
  const [ptyId, setPtyId] = useState<string | null>(null)

  const setStatus = useCallback((status: PtyStatus, message?: string) => {
    setStatusState(status)
    setStatusMessage(message)
    onStatus?.(status, message)
  }, [onStatus])

  const openSseStream = useCallback((ptyId: string) => {
    closeStreamRef.current?.()
    closeStreamRef.current = openEventStream(
      `/api/stream/pty/${ptyId}`,
      (event) => {
        try {
          const data = JSON.parse(event.data) as PtyEventPayload | { event: PtyEventPayload }
          const evt = "event" in data ? data.event : data
          handleEvent(evt, termRef)
          if (evt.type === "pty.exit" || evt.type === "terminal.exit") setStatus("exited")
          if (evt.type === "pty.error" || evt.type === "terminal.error") setStatus("error", evt.message)
        } catch {}
      },
    )
  }, [setStatus, termRef])

  const flushWriteQueue = useCallback(async () => {
    if (!ptyIdRef.current || writeQueueRef.current.length === 0) return
    const queued = writeQueueRef.current.splice(0)
    for (const data of queued) {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "write", data }))
      } else {
        await invoke("middleware_pty_write", {
          input: { ptyId: ptyIdRef.current, data },
        })
      }
    }
  }, [])

  const cleanup = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    closeStreamRef.current?.()
    closeStreamRef.current = null
    writeQueueRef.current = []
    setPtyId(null)
    if (ptyIdRef.current) {
      const id = ptyIdRef.current
      ptyIdRef.current = null
      invoke("middleware_pty_kill", { input: { ptyId: id } }).catch(() => {})
    }
    setStatus("idle")
  }, [setStatus])

  const spawn = useCallback(
    async (rows: number, cols: number, signal: { aborted: boolean }) => {
      cleanup()

      if (signal.aborted) return { ptyId: "", cwd: "" } as SpawnResult
      setStatus("spawning")

      const result = await invoke<SpawnResult>("middleware_pty_spawn", {
        input: { rows, cols, projectId: projectId ?? undefined },
      })

      if (signal.aborted) {
        invoke("middleware_pty_kill", { input: { ptyId: result.ptyId } }).catch(() => {})
        return result
      }

      ptyIdRef.current = result.ptyId
      setPtyId(result.ptyId)
      setCwd(result.cwd || null)
      const wsUrl = middlewareWsUrl(result.websocketUrl)
      if (wsUrl) {
        const ws = new WebSocket(wsUrl)
        wsRef.current = ws
        ws.onopen = () => {
          setStatus("connected")
          void flushWriteQueue()
        }
        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data) as { data?: unknown } | PtyEventPayload
            const evt = typeof payload === "object" && payload && "data" in payload && typeof payload.data === "object" && payload.data
              ? payload.data as PtyEventPayload
              : payload as PtyEventPayload
            handleEvent(evt, termRef)
            if (evt.type === "pty.exit" || evt.type === "terminal.exit") setStatus("exited")
            if (evt.type === "pty.error" || evt.type === "terminal.error") setStatus("error", evt.message)
          } catch {}
        }
        const fallbackToSse = () => {
          if (!ptyIdRef.current || closeStreamRef.current) return
          setStatus("stream_failed", "websocket terminal stream unavailable")
          termRef.current?.write("\r\n\x1b[33m[websocket terminal stream unavailable, falling back to SSE]\x1b[0m\r\n")
          openSseStream(ptyIdRef.current)
          void flushWriteQueue()
        }
        ws.onerror = () => {
          fallbackToSse()
          try { ws.close() } catch {}
        }
        ws.onclose = () => {
          if (ptyIdRef.current && !signal.aborted) fallbackToSse()
        }
      } else {
        setStatus("connected")
        openSseStream(result.ptyId)
        void flushWriteQueue()
      }

      return result
    },
    [termRef, cleanup, projectId, setStatus, flushWriteQueue, openSseStream],
  )

  const write = useCallback(async (data: string) => {
    if (!ptyIdRef.current) {
      writeQueueRef.current.push(data)
      return
    }
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "write", data }))
      return
    }
    await invoke("middleware_pty_write", {
      input: { ptyId: ptyIdRef.current, data },
    })
  }, [])

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

  return { spawn, write, resize, cleanup, status, statusMessage, cwd, ptyId }
}
