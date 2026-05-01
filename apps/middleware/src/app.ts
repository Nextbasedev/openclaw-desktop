import express from "express"
import cors from "cors"
import net from "node:net"
import type { MiddlewareConfig } from "./config.js"
import { authMiddleware } from "./auth.js"
import { HttpError } from "./lib/http-error.js"
import { Store } from "./services/store.js"
import { projectRoutes, repoRoutes } from "./services/projects.js"
import { gitRoutes } from "./services/git.js"
import { workspaceRoutes } from "./services/workspace.js"
import { terminalRoutes } from "./services/terminal.js"
import { recordRoutes } from "./services/records.js"
import { commandRoutes } from "./services/commands.js"
import { connectGateway } from "./services/gateway.js"

async function isOpenClawGatewayReachable(gatewayUrl: string) {
  try {
    const parsed = new URL(gatewayUrl)
    const host = parsed.hostname || "127.0.0.1"
    const port = Number(parsed.port || (parsed.protocol === "wss:" ? 443 : 80))
    return await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port })
      const timer = setTimeout(() => { socket.destroy(); resolve(false) }, 500)
      socket.once("connect", () => { clearTimeout(timer); socket.destroy(); resolve(true) })
      socket.once("error", () => { clearTimeout(timer); resolve(false) })
    })
  } catch {
    return false
  }
}

export function createStore(config: MiddlewareConfig) {
  return new Store(config)
}

export function createApp(config: MiddlewareConfig, injectedStore?: Store) {
  const app = express()
  const store = injectedStore ?? createStore(config)
  const projects = projectRoutes(store)
  const repos = repoRoutes(store, config.workspaceRoot)
  const git = gitRoutes(store)
  const workspace = workspaceRoutes(store)
  const terminal = terminalRoutes(store)
  const records = recordRoutes(store)
  const commands = commandRoutes(store)

  app.use(cors({ origin: true, credentials: false }))
  app.use(express.json({ limit: "150mb" }))

  app.get("/health", async (_req, res) => {
    const gatewayConnected = await isOpenClawGatewayReachable(config.openclawGatewayUrl)
    res.json({
      ok: true,
      service: "openclaw-middleware",
      version: "0.1.0",
      host: config.host,
      openclaw: { gatewayUrl: config.openclawGatewayUrl, connected: gatewayConnected },
      pairing: { enabled: true },
    })
  })


  function publicUrl(req: express.Request) {
    const proto = req.header("x-forwarded-proto") || req.protocol || "http"
    const host = req.header("x-forwarded-host") || req.header("host") || `${config.host}:${config.port}`
    return `${proto}://${host}`
  }
  function isLoopback(req: express.Request) {
    const ip = req.ip || req.socket.remoteAddress || ""
    return ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1" || ip.includes("127.0.0.1")
  }

  app.get("/pairing/local", async (req, res, next) => {
    if (!isLoopback(req)) return next(new HttpError(403, "Local pairing is only available from this computer", "FORBIDDEN"))
    const gatewayConnected = await isOpenClawGatewayReachable(config.openclawGatewayUrl)
    if (!gatewayConnected) return next(new HttpError(503, "OpenClaw Gateway is not running locally", "OPENCLAW_GATEWAY_UNAVAILABLE"))
    res.json({ ok: true, url: publicUrl(req), token: config.token, mode: "local", openclaw: { connected: true } })
  })

  app.post("/pairing/claim", async (req, res, next) => {
    const code = String(req.body?.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    const expected = config.pairingCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
    if (!code || code !== expected) return next(new HttpError(401, "Invalid pairing code", "UNAUTHORIZED"))
    const gatewayConnected = await isOpenClawGatewayReachable(config.openclawGatewayUrl)
    if (!gatewayConnected) return next(new HttpError(503, "OpenClaw Gateway is not running on this server", "OPENCLAW_GATEWAY_UNAVAILABLE"))
    res.json({ ok: true, url: publicUrl(req), token: config.token, mode: "remote", openclaw: { connected: true } })
  })

  app.use("/api", authMiddleware(config))

  app.get("/api/version", (_req, res) => res.json({ ok: true, version: "0.1.0", service: "openclaw-middleware" }))
  app.post("/api/commands/:command", async (req, res, next) => { try { res.json(await commands.handle(req.params.command, req.body?.input ?? req.body ?? {})) } catch (error) { next(error) } })

  app.get("/api/projects", (_req, res) => res.json(projects.list()))
  app.post("/api/projects", (req, res) => res.json(projects.create(req.body)))
  app.patch("/api/projects/:projectId", (req, res) => res.json(projects.update(req.params.projectId, req.body)))
  app.delete("/api/projects/:projectId", (req, res) => res.json(projects.delete(req.params.projectId)))

  app.get("/api/topics", (req, res) => res.json(records.topicsList(String(req.query.projectId ?? ""))))
  app.post("/api/topics", (req, res) => res.json(records.topicsCreate(req.body)))
  app.patch("/api/topics/:topicId", (req, res) => res.json(records.topicsUpdate(req.params.topicId, req.body)))
  app.delete("/api/topics/:topicId", (req, res) => res.json(records.topicsDelete(req.params.topicId)))
  app.post("/api/topics/:topicId/archive", (req, res) => res.json(records.topicsArchive(req.params.topicId, req.body?.archived ?? true)))

  app.get("/api/chats", (_req, res) => res.json(records.chatsList()))
  app.post("/api/chats", (req, res) => res.json(records.chatsCreate(req.body)))
  app.patch("/api/chats/:chatId", (req, res) => res.json(records.chatsUpdate(req.params.chatId, req.body)))
  app.post("/api/chats/:chatId/rename", (req, res) => res.json(records.chatsRename(req.params.chatId, String(req.body?.name ?? "New Chat"))))
  app.post("/api/chats/:chatId/archive", (req, res) => res.json(records.chatsArchive(req.params.chatId, req.body?.archived ?? true)))
  app.delete("/api/chats/:chatId", (req, res) => res.json(records.chatsDelete(req.params.chatId)))
  app.post("/api/chats/:chatId/session", (req, res) => res.json(records.chatsAttachSession(req.params.chatId, String(req.body?.sessionKey ?? ""))))

  app.get("/api/sessions", (_req, res) => res.json(records.sessionsList()))
  app.post("/api/sessions", (req, res) => res.json(records.sessionsCreate(req.body)))

  app.get("/api/repos/recent", (_req, res) => res.json(repos.recent()))
  app.post("/api/repos/scan", (_req, res) => res.json(repos.scan()))
  app.post("/api/repos/select", (req, res) => res.json(repos.select(req.body)))

  app.get("/api/projects/:projectId/git/status", (req, res) => res.json(git.status(req.params.projectId)))
  app.get("/api/projects/:projectId/git/diff", (req, res) => res.json(git.diff(req.params.projectId, String(req.query.path ?? ""))))
  app.get("/api/projects/:projectId/git/branches", (req, res) => res.json(git.branches(req.params.projectId)))
  app.post("/api/projects/:projectId/git/checkout", (req, res) => res.json(git.checkout(req.params.projectId, String(req.body?.branch ?? req.body?.branchName ?? ""))))

  app.get("/api/projects/:projectId/workspace/tree", (req, res) => res.json(workspace.tree(req.params.projectId, String(req.query.path ?? ""))))
  app.get("/api/projects/:projectId/workspace/file", (req, res) => res.json(workspace.read(req.params.projectId, String(req.query.path ?? ""))))
  app.put("/api/projects/:projectId/workspace/file", (req, res) => res.json(workspace.write(req.params.projectId, String(req.body?.path ?? ""), String(req.body?.content ?? ""))))

  app.post("/api/projects/:projectId/terminal/spawn", async (req, res, next) => { try { res.json(await terminal.spawn(req.params.projectId, req.body)) } catch (error) { next(error) } })
  app.post("/api/terminal/:terminalId/write", (req, res) => res.json(terminal.write(req.params.terminalId, String(req.body?.data ?? ""))))
  app.post("/api/terminal/:terminalId/resize", (req, res) => res.json(terminal.resize(req.params.terminalId, Number(req.body?.cols ?? 80), Number(req.body?.rows ?? 24))))
  app.post("/api/terminal/:terminalId/kill", (req, res) => res.json(terminal.kill(req.params.terminalId)))
  app.get("/api/terminal/:terminalId/stream", (req, res) => terminal.stream(req.params.terminalId, res))

  app.get("/api/stream/chat/:sessionKey", async (req, res, next) => {
    const sessionKey = req.params.sessionKey
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    })
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    let gateway: Awaited<ReturnType<typeof connectGateway>> | null = null
    send("chat.ready", { type: "chat.ready", sessionKey })
    try {
      gateway = await connectGateway(["operator.read", "operator.write", "operator.admin", "operator.approvals"])
      send("chat.status", { type: "chat.status", sessionKey, state: "connected" })
      await gateway.request("sessions.subscribe", {}, 30_000).catch(() => null)
      await gateway.request("sessions.messages.subscribe", { key: sessionKey }, 30_000).catch(() => null)
      const off = gateway.on((message) => {
        if (message.type !== "event") return
        const payload = message.payload as any
        if (payload?.sessionKey && payload.sessionKey !== sessionKey) return
        if (message.event === "session.message" && payload?.message) {
          const content = payload.message.content
          const text = Array.isArray(content)
            ? content.map((b:any) => typeof b?.text === "string" ? b.text : "").join("")
            : typeof content === "string" ? content : ""
          if (payload.message.role === "assistant") {
            send("chat.message", { type: "chat.message", sessionKey, messageId: payload.message.id ?? payload.messageId ?? null, role: payload.message.role, content, text, createdAt: payload.message.createdAt ?? null, model: payload.message.model ?? null, usage: payload.message.usage ?? null, stopReason: payload.message.stopReason ?? null })
            send("chat.status", { type: "chat.status", sessionKey, state: text ? "done" : "streaming" })
          }
        } else if (message.event === "chat") {
          if (payload?.sessionKey && payload.sessionKey !== sessionKey) return
          const state = payload?.state
          const content = payload?.message?.content
          const text = Array.isArray(content) ? content.map((b:any) => typeof b?.text === "string" ? b.text : "").join("") : ""
          if (text) send("chat.message", { type: "chat.message", sessionKey, messageId: payload?.runId ?? null, role: "assistant", content, text, createdAt: null, model: payload?.message?.model ?? null, usage: state === "final" ? payload?.usage ?? null : null, stopReason: state === "final" ? payload?.stopReason ?? null : null })
          if (state === "final") send("chat.status", { type: "chat.status", sessionKey, state: "done" })
          if (state === "error") send("chat.status", { type: "chat.status", sessionKey, state: "error" })
        } else if (message.event === "session.tool" && payload?.data) {
          send("chat.tool", { type: "chat.tool", sessionKey, ...payload.data })
        }
      })
      req.on("close", () => { off(); gateway?.close() })
    } catch (error) {
      send("chat.status", { type: "chat.status", sessionKey, state: "error", label: error instanceof Error ? error.message : "stream_error" })
      gateway?.close()
    }
  })

  app.use((req, _res, next) => next(new HttpError(404, `Route not found: ${req.method} ${req.path}`, "NOT_FOUND")))

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof HttpError ? error.status : 500
    const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR"
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(status).json({ ok: false, error: { code, message } })
  })

  return app
}
