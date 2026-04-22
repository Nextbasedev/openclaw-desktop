import { useRef, useCallback } from "react"
import type { Terminal } from "@xterm/xterm"
import { invoke, openEventStream } from "@/lib/ipc"

type PtyEventPayload = {
  type: "pty.data" | "pty.exit" | "pty.error"
  ptyId: string
  data?: string
  message?: string
}

type SpawnResult = { ptyId: string; cwd: string }

function handleEvent(
  evt: PtyEventPayload,
  termRef: React.RefObject<Terminal | null>,
) {
  if (evt.type === "pty.data" && evt.data) {
    termRef.current?.write(evt.data)
  } else if (evt.type === "pty.exit") {
    termRef.current?.write("\r\n\x1b[90m[process exited]\x1b[0m\r\n")
  } else if (evt.type === "pty.error" && evt.message) {
    termRef.current?.write(`\r\n\x1b[31m[error: ${evt.message}]\x1b[0m\r\n`)
  }
}

export function usePty(termRef: React.RefObject<Terminal | null>) {
  const ptyIdRef = useRef<string | null>(null)
  const closeStreamRef = useRef<(() => void) | null>(null)

  const cleanup = useCallback(() => {
    closeStreamRef.current?.()
    closeStreamRef.current = null
    if (ptyIdRef.current) {
      const id = ptyIdRef.current
      ptyIdRef.current = null
      invoke("middleware_pty_kill", { input: { ptyId: id } }).catch(() => {})
    }
  }, [])

  const spawn = useCallback(
    async (rows: number, cols: number, signal: { aborted: boolean }) => {
      cleanup()

      if (signal.aborted) return { ptyId: "", cwd: "" } as SpawnResult

      const result = await invoke<SpawnResult>("middleware_pty_spawn", {
        input: { rows, cols },
      })

      if (signal.aborted) {
        invoke("middleware_pty_kill", { input: { ptyId: result.ptyId } }).catch(() => {})
        return result
      }

      ptyIdRef.current = result.ptyId

      closeStreamRef.current = openEventStream(
        `/api/stream/pty/${result.ptyId}`,
        (event) => {
          try {
            const data = JSON.parse(event.data) as PtyEventPayload | { event: PtyEventPayload }
            const evt = "event" in data ? data.event : data
            handleEvent(evt, termRef)
          } catch {
            // ignore malformed events
          }
        },
      )

      return result
    },
    [termRef, cleanup],
  )

  const write = useCallback(async (data: string) => {
    if (!ptyIdRef.current) return
    await invoke("middleware_pty_write", {
      input: { ptyId: ptyIdRef.current, data },
    })
  }, [])

  const resize = useCallback(async (rows: number, cols: number) => {
    if (!ptyIdRef.current) return
    await invoke("middleware_pty_resize", {
      input: { ptyId: ptyIdRef.current, rows, cols },
    })
  }, [])

  return { spawn, write, resize, cleanup }
}
