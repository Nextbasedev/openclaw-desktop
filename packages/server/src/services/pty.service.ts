import { EventEmitter } from "node:events"
import { generateId } from "../db/helpers.js"
import { MAX_SESSIONS } from "./terminal.service.js"

const DEFAULT_PTY_COLS = 80
const DEFAULT_PTY_ROWS = 24

export const ptyEvents = new EventEmitter()

interface PtyHandle {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  cwd: string
}

const activePtys = new Map<string, PtyHandle>()

function getShell(): string {
  if (process.platform === "win32") {
    return process.env.COMSPEC || "powershell.exe"
  }
  return process.env.SHELL || "/bin/sh"
}

async function loadNodePty() {
  try {
    return await import("node-pty")
  } catch {
    throw new Error(
      "node-pty is not installed. Run: pnpm add node-pty",
    )
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
  const cwd = input.cwd ?? process.cwd()
  const shell = getShell()
  const ptyId = generateId("pty")

  const ptyMod = await loadNodePty()
  const ptyProcess = ptyMod.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: process.env as Record<string, string>,
  })

  const handle: PtyHandle = {
    write: (data: string) => ptyProcess.write(data),
    resize: (c: number, r: number) => ptyProcess.resize(c, r),
    kill: () => ptyProcess.kill(),
    cwd,
  }
  activePtys.set(ptyId, handle)

  ptyProcess.onData((data: string) => {
    ptyEvents.emit(`pty:data:${ptyId}`, { ptyId, data })
  })

  ptyProcess.onExit(() => {
    ptyEvents.emit(`pty:exit:${ptyId}`, { ptyId })
    activePtys.delete(ptyId)
  })

  return { ptyId, cwd }
}

export function ptyWrite(input: {
  ptyId: string
  data: string
}) {
  const handle = activePtys.get(input.ptyId)
  if (!handle) {
    throw new Error(`PTY not found: ${input.ptyId}`)
  }
  handle.write(input.data)
  return { ok: true }
}

export function ptyResize(input: {
  ptyId: string
  cols: number
  rows: number
}) {
  const handle = activePtys.get(input.ptyId)
  if (!handle) {
    throw new Error(`PTY not found: ${input.ptyId}`)
  }
  handle.resize(input.cols, input.rows)
  return { ok: true }
}

export function ptyKill(input: { ptyId: string }) {
  const handle = activePtys.get(input.ptyId)
  if (!handle) {
    throw new Error(`PTY not found: ${input.ptyId}`)
  }
  handle.kill()
  activePtys.delete(input.ptyId)
  return { ok: true, ptyId: input.ptyId }
}

export function _getActivePtys(): Map<string, PtyHandle> {
  return activePtys
}
