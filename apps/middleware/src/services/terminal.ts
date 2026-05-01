import crypto from "node:crypto"
import os from "node:os"
import type { IncomingMessage } from "node:http"
import type { Response } from "express"
import type { IPty } from "node-pty"
import type WebSocket from "ws"
import type { Store } from "./store.js"
import { spawnTerminal } from "./terminal-process.js"
import { HttpError } from "../lib/http-error.js"

type Term = {
  id: string
  proc: IPty
  buffer: string[]
  sseListeners: Set<Response>
  wsListeners: Set<WebSocket>
}

const terms = new Map<string, Term>()

function shell() {
  return os.platform() === "win32" ? "powershell.exe" : process.env.SHELL || "bash"
}

function eventPayload(type: string, terminalId: string, data: Record<string, unknown> = {}) {
  return { type, terminalId, ...data }
}

function writeSse(res: Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

function broadcast(term: Term, event: string, payload: unknown) {
  for (const res of term.sseListeners) writeSse(res, event, payload)
  const encoded = JSON.stringify({ event, data: payload })
  for (const ws of term.wsListeners) {
    if (ws.readyState === ws.OPEN) ws.send(encoded)
  }
}

function getTerm(id: string) {
  const term = terms.get(id)
  if (!term) throw new HttpError(404, "Terminal not found", "NOT_FOUND")
  return term
}

export function terminalRoutes(store: Store) {
  return {
    spawn: async (projectId: string, body: any) => {
      const p = store.getProject(projectId)
      if (!p) throw new HttpError(404, "Project not found", "NOT_FOUND")
      const cwd = p.repoRoot || p.workspaceRoot
      const id = `term_${crypto.randomUUID().replace(/-/g, "")}`
      const proc = await spawnTerminal(shell(), cwd, Number(body?.cols ?? 80), Number(body?.rows ?? 24))
      const term: Term = { id, proc, buffer: [], sseListeners: new Set(), wsListeners: new Set() }
      proc.onData((data) => {
        term.buffer.push(data)
        if (term.buffer.length > 200) term.buffer.shift()
        broadcast(term, "data", eventPayload("terminal.data", id, { data }))
      })
      proc.onExit((e) => {
        broadcast(term, "exit", eventPayload("terminal.exit", id, { exitCode: e.exitCode }))
        terms.delete(id)
      })
      terms.set(id, term)
      return { terminalId: id, cwd, streamUrl: `/api/terminal/${id}/stream`, websocketUrl: `/api/terminal/${id}/ws` }
    },
    write: (id: string, data: string) => {
      getTerm(id).proc.write(data)
      return { ok: true }
    },
    resize: (id: string, cols: number, rows: number) => {
      getTerm(id).proc.resize(cols, rows)
      return { ok: true }
    },
    kill: (id: string) => {
      const t = terms.get(id)
      if (t) {
        t.proc.kill()
        terms.delete(id)
      }
      return { ok: true }
    },
    stream: (id: string, res: Response) => {
      const term = getTerm(id)
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" })
      term.sseListeners.add(res)
      for (const data of term.buffer) writeSse(res, "data", eventPayload("terminal.data", id, { data }))
      res.on("close", () => term.sseListeners.delete(res))
    },
    attachWebSocket: (id: string, ws: WebSocket, _req: IncomingMessage) => {
      const term = getTerm(id)
      term.wsListeners.add(ws)
      for (const data of term.buffer) ws.send(JSON.stringify({ event: "data", data: eventPayload("terminal.data", id, { data }) }))
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as { type?: string; data?: string; cols?: number; rows?: number }
          if (msg.type === "write" && typeof msg.data === "string") term.proc.write(msg.data)
          if (msg.type === "resize" && msg.cols && msg.rows) term.proc.resize(msg.cols, msg.rows)
          if (msg.type === "kill") term.proc.kill()
        } catch {}
      })
      ws.on("close", () => term.wsListeners.delete(ws))
    },
  }
}
