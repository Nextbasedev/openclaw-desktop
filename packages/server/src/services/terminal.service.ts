import { EventEmitter } from "node:events"
import fs from "node:fs"
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

const TERMINAL_COLUMNS =
  "id, project_id, topic_id, title, cwd, status, last_active_at, runtime_id"

export const terminalEvents = new EventEmitter()

interface TerminalHandle {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  runtimeId: string
}

const activeTerminals = new Map<string, TerminalHandle>()

function getShell(): string {
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

  const cwd = input.cwd ?? project.workspace_root
  if (!fs.existsSync(cwd)) {
    throw new Error(`Directory not found: ${cwd}`)
  }
  const stat = fs.statSync(cwd)
  if (!stat.isDirectory()) {
    throw new Error(`Not a directory: ${cwd}`)
  }

  if (activeTerminals.size >= MAX_SESSIONS) {
    throw new Error(
      `Maximum session limit reached (${MAX_SESSIONS})`,
    )
  }

  const cols = input.cols ?? DEFAULT_TERMINAL_COLS
  const rows = input.rows ?? DEFAULT_TERMINAL_ROWS
  const title = input.title ?? "Terminal"
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

  const ptyMod = await loadNodePty()
  const shell = getShell()
  const ptyProcess = ptyMod.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env: process.env as Record<string, string>,
  })

  const handle: TerminalHandle = {
    write: (data: string) => ptyProcess.write(data),
    resize: (c: number, r: number) => ptyProcess.resize(c, r),
    kill: () => ptyProcess.kill(),
    runtimeId,
  }
  activeTerminals.set(sessionId, handle)

  ptyProcess.onData((data: string) => {
    terminalEvents.emit(`terminal:output:${sessionId}`, {
      sessionId,
      data,
    })
  })

  ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
    terminalEvents.emit(`terminal:exit:${sessionId}`, {
      sessionId,
      code: exitCode,
    })
    activeTerminals.delete(sessionId)
    try {
      db.prepare(
        "UPDATE terminal_sessions SET status = 'closed', last_active_at = ? WHERE id = ?",
      ).run(nowIso(), sessionId)
    } catch {
      // DB may be closed during shutdown
    }
  })

  const row = db
    .prepare(
      `SELECT ${TERMINAL_COLUMNS} FROM terminal_sessions WHERE id = ?`,
    )
    .get(sessionId) as TerminalRow

  return { terminal: terminalRowToJson(row) }
}

export function terminalList(input: { projectId: string }) {
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT ${TERMINAL_COLUMNS} FROM terminal_sessions WHERE project_id = ? ORDER BY last_active_at DESC`,
    )
    .all(input.projectId) as TerminalRow[]
  return { terminals: rows.map(terminalRowToJson) }
}

export function terminalWrite(input: {
  sessionId: string
  data: string
}) {
  const handle = activeTerminals.get(input.sessionId)
  if (!handle) {
    throw new Error(
      `Terminal session not found or not active: ${input.sessionId}`,
    )
  }

  handle.write(input.data)

  const db = getDb()
  db.prepare(
    "UPDATE terminal_sessions SET last_active_at = ? WHERE id = ?",
  ).run(nowIso(), input.sessionId)

  return { ok: true }
}

export function terminalResize(input: {
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

  handle.resize(input.cols, input.rows)
  return { ok: true }
}

export function terminalClose(input: { sessionId: string }) {
  const handle = activeTerminals.get(input.sessionId)
  if (!handle) {
    throw new Error(
      `Terminal session not found or not active: ${input.sessionId}`,
    )
  }

  handle.kill()
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
