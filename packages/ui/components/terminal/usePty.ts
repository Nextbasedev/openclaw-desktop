import { useRef, useCallback } from "react"
import type { Terminal } from "@xterm/xterm"
import { tauriInvoke, tauriListen } from "@/lib/tauri"

type PtyEvent = {
  ptyId: string
  event: {
    type: "pty.data" | "pty.exit" | "pty.error"
    ptyId: string
    data?: string
    message?: string
  }
}

type SpawnResult = { ptyId: string; cwd: string }

function handleEvent(
  evt: PtyEvent["event"],
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
  const unlistenRef = useRef<(() => void) | null>(null)

  const cleanup = useCallback(() => {
    unlistenRef.current?.()
    unlistenRef.current = null
    if (ptyIdRef.current) {
      const id = ptyIdRef.current
      ptyIdRef.current = null
      tauriInvoke("middleware_pty_kill", { input: { ptyId: id } }).catch(() => {})
    }
  }, [])

  const spawn = useCallback(
    async (rows: number, cols: number, signal: { aborted: boolean }) => {
      cleanup()

      const earlyEvents: PtyEvent[] = []
      let myPtyId: string | null = null

      unlistenRef.current = await tauriListen<PtyEvent>(
        "middleware://pty-event",
        (payload) => {
          if (myPtyId) {
            if (payload.ptyId !== myPtyId) return
            handleEvent(payload.event, termRef)
          } else {
            earlyEvents.push(payload)
          }
        },
      )

      if (signal.aborted) {
        unlistenRef.current?.()
        unlistenRef.current = null
        return { ptyId: "", cwd: "" } as SpawnResult
      }

      const result = await tauriInvoke<SpawnResult>("middleware_pty_spawn", {
        input: { rows, cols },
      })

      if (signal.aborted) {
        unlistenRef.current?.()
        unlistenRef.current = null
        tauriInvoke("middleware_pty_kill", { input: { ptyId: result.ptyId } }).catch(() => {})
        return result
      }

      myPtyId = result.ptyId
      ptyIdRef.current = result.ptyId

      for (const evt of earlyEvents) {
        if (evt.ptyId === myPtyId) {
          handleEvent(evt.event, termRef)
        }
      }

      return result
    },
    [termRef, cleanup],
  )

  const write = useCallback(async (data: string) => {
    if (!ptyIdRef.current) return
    await tauriInvoke("middleware_pty_write", {
      input: { ptyId: ptyIdRef.current, data },
    })
  }, [])

  const resize = useCallback(async (rows: number, cols: number) => {
    if (!ptyIdRef.current) return
    await tauriInvoke("middleware_pty_resize", {
      input: { ptyId: ptyIdRef.current, rows, cols },
    })
  }, [])

  return { spawn, write, resize, cleanup }
}
