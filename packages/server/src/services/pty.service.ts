import { EventEmitter } from "node:events"
import { ensureGatewayClient } from "../gateway/client.js"
import { generateId } from "../db/helpers.js"

const MAX_SESSIONS = 20
const DEFAULT_PTY_COLS = 80
const DEFAULT_PTY_ROWS = 24
const POLL_MS = 100

export const ptyEvents = new EventEmitter()

interface PtyHandle {
  terminalId: string
  stopPolling: () => void
  cwd: string
}

const activePtys = new Map<string, PtyHandle>()

function startPolling(
  ptyId: string,
  terminalId: string,
) {
  let stopped = false

  async function poll() {
    while (!stopped) {
      try {
        const gw = await ensureGatewayClient()
        const res = await gw.request<{
          data?: string
          exited?: boolean
          exitCode?: number
        }>("terminal.read", { terminalId })
        if (!res.ok) break
        const p = res.payload
        if (p?.data) {
          ptyEvents.emit(`pty:data:${ptyId}`, {
            ptyId,
            data: p.data,
          })
        }
        if (p?.exited) {
          ptyEvents.emit(`pty:exit:${ptyId}`, { ptyId })
          activePtys.delete(ptyId)
          break
        }
      } catch {
        break
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
  }

  poll()
  return () => {
    stopped = true
  }
}

export async function ptySpawn(input: {
  cwd?: string
  cols?: number
  rows?: number
}) {
  if (activePtys.size >= MAX_SESSIONS) {
    throw new Error(
      `Maximum session limit reached (${MAX_SESSIONS})`,
    )
  }

  const cols = input.cols ?? DEFAULT_PTY_COLS
  const rows = input.rows ?? DEFAULT_PTY_ROWS
  const ptyId = generateId("pty")

  const gw = await ensureGatewayClient()
  const res = await gw.request<{
    terminalId?: string
    cwd?: string
  }>("terminal.spawn", { cols, rows, cwd: input.cwd })

  if (!res.ok || !res.payload?.terminalId) {
    throw new Error(
      res.error?.message ?? "terminal.spawn failed",
    )
  }

  const terminalId = res.payload.terminalId
  const cwd = res.payload.cwd ?? input.cwd ?? ""
  const stopPolling = startPolling(ptyId, terminalId)

  activePtys.set(ptyId, {
    terminalId,
    stopPolling,
    cwd,
  })

  return { ptyId, cwd }
}

export async function ptyWrite(input: {
  ptyId: string
  data: string
}) {
  const handle = activePtys.get(input.ptyId)
  if (!handle) {
    throw new Error(`PTY not found: ${input.ptyId}`)
  }
  const gw = await ensureGatewayClient()
  const res = await gw.request("terminal.write", {
    terminalId: handle.terminalId,
    data: input.data,
  })
  if (!res.ok) {
    throw new Error(
      res.error?.message ?? "terminal.write failed",
    )
  }
  return { ok: true }
}

export async function ptyResize(input: {
  ptyId: string
  cols: number
  rows: number
}) {
  const handle = activePtys.get(input.ptyId)
  if (!handle) {
    throw new Error(`PTY not found: ${input.ptyId}`)
  }
  const gw = await ensureGatewayClient()
  await gw.request("terminal.resize", {
    terminalId: handle.terminalId,
    cols: input.cols,
    rows: input.rows,
  })
  return { ok: true }
}

export async function ptyKill(input: { ptyId: string }) {
  const handle = activePtys.get(input.ptyId)
  if (!handle) {
    throw new Error(`PTY not found: ${input.ptyId}`)
  }
  handle.stopPolling()
  const gw = await ensureGatewayClient()
  await gw.request("terminal.kill", {
    terminalId: handle.terminalId,
  })
  activePtys.delete(input.ptyId)
  return { ok: true, ptyId: input.ptyId }
}

export function _getActivePtys(): Map<string, PtyHandle> {
  return activePtys
}
