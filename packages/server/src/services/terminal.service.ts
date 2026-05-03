import { EventEmitter } from "node:events"
import { ensureGatewayClient } from "../gateway/client.js"
import { getDb } from "../db/connection.js"
import {
  nowIso,
  generateId,
  terminalRowToJson,
  type TerminalRow,
} from "../db/helpers.js"

export const MAX_SESSIONS = 20
const DEFAULT_TERMINAL_COLS = 120
const DEFAULT_TERMINAL_ROWS = 30
const POLL_MS = 100

const TERMINAL_COLUMNS =
  "id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id"

export const terminalEvents = new EventEmitter()

interface TerminalHandle {
  terminalId: string
  stopPolling: () => void
  runtimeId: string
}

const activeTerminals = new Map<string, TerminalHandle>()

function startPolling(
  sessionId: string,
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
          terminalEvents.emit(
            `terminal:output:${sessionId}`,
            { sessionId, data: p.data },
          )
        }
        if (p?.exited) {
          terminalEvents.emit(
            `terminal:exit:${sessionId}`,
            { sessionId, code: p.exitCode },
          )
          activeTerminals.delete(sessionId)
          try {
            const db = getDb()
            db.prepare(
              "UPDATE terminal_sessions SET status = 'closed', last_active_at = ? WHERE id = ?",
            ).run(nowIso(), sessionId)
          } catch {}
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

export async function terminalCreate(input: {
  projectId: string
  topicId?: string
  cwd?: string
  title?: string
  cols?: number
  rows?: number
}) {
  const db = getDb()

  const project = db
    .prepare(
      "SELECT id, workspace_root FROM projects WHERE id = ?",
    )
    .get(input.projectId) as
    | { id: string; workspace_root: string }
    | undefined
  if (!project) {
    throw new Error(`Project not found: ${input.projectId}`)
  }

  if (activeTerminals.size >= MAX_SESSIONS) {
    throw new Error(
      `Maximum session limit reached (${MAX_SESSIONS})`,
    )
  }

  const cols = input.cols ?? DEFAULT_TERMINAL_COLS
  const rows = input.rows ?? DEFAULT_TERMINAL_ROWS
  const title = input.title ?? "Terminal"
  const cwd = input.cwd ?? project.workspace_root
  const now = nowIso()
  const sessionId = generateId("term")
  const runtimeId = generateId("rt")

  db.prepare(
    `INSERT INTO terminal_sessions (${TERMINAL_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionId,
    input.projectId,
    input.topicId ?? null,
    title,
    cwd,
    "running",
    now,
    runtimeId,
  )

  const gw = await ensureGatewayClient()
  const res = await gw.request<{
    terminalId?: string
    cwd?: string
  }>("terminal.spawn", { cols, rows, cwd })

  if (!res.ok || !res.payload?.terminalId) {
    throw new Error(
      res.error?.message ?? "terminal.spawn failed",
    )
  }

  const stopPolling = startPolling(
    sessionId,
    res.payload.terminalId,
  )

  activeTerminals.set(sessionId, {
    terminalId: res.payload.terminalId,
    stopPolling,
    runtimeId,
  })

  const row = db
    .prepare(
      `SELECT ${TERMINAL_COLUMNS} FROM terminal_sessions WHERE id = ?`,
    )
    .get(sessionId) as TerminalRow

  return { terminal: terminalRowToJson(row) }
}

export function terminalList(input: {
  projectId: string
}) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT ${TERMINAL_COLUMNS} FROM terminal_sessions WHERE project_id = ? ORDER BY last_active_at DESC`,
    )
    .all(input.projectId) as TerminalRow[]
  return { terminals: rows.map(terminalRowToJson) }
}

export async function terminalWrite(input: {
  sessionId: string
  data: string
}) {
  const handle = activeTerminals.get(input.sessionId)
  if (!handle) {
    throw new Error(
      `Terminal session not found or not active: ${input.sessionId}`,
    )
  }

  const gw = await ensureGatewayClient()
  await gw.request("terminal.write", {
    terminalId: handle.terminalId,
    data: input.data,
  })

  const db = getDb()
  db.prepare(
    "UPDATE terminal_sessions SET last_active_at = ? WHERE id = ?",
  ).run(nowIso(), input.sessionId)

  return { ok: true }
}

export async function terminalResize(input: {
  sessionId: string
  cols: number
  rows: number
}) {
  const handle = activeTerminals.get(input.sessionId)
  if (!handle) {
    throw new Error(
      `Terminal session not found or not active: ${input.sessionId}`,
    )
  }

  const gw = await ensureGatewayClient()
  await gw.request("terminal.resize", {
    terminalId: handle.terminalId,
    cols: input.cols,
    rows: input.rows,
  })
  return { ok: true }
}

export async function terminalClose(input: {
  sessionId: string
}) {
  const handle = activeTerminals.get(input.sessionId)
  if (!handle) {
    throw new Error(
      `Terminal session not found or not active: ${input.sessionId}`,
    )
  }

  handle.stopPolling()
  const gw = await ensureGatewayClient()
  await gw.request("terminal.kill", {
    terminalId: handle.terminalId,
  })
  activeTerminals.delete(input.sessionId)

  const db = getDb()
  db.prepare(
    "UPDATE terminal_sessions SET status = 'closed', last_active_at = ? WHERE id = ?",
  ).run(nowIso(), input.sessionId)

  return { ok: true, sessionId: input.sessionId }
}

export function _getActiveTerminals(): Map<
  string,
  TerminalHandle
> {
  return activeTerminals
}
