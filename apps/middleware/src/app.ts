import express from "express"
import cors from "cors"
import net from "node:net"
import fs from "node:fs"
import path from "node:path"
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
import { connectGateway, isSharedGatewayEnabled } from "./services/gateway.js"
import { registerChatStreamClient } from "./services/chat-stream-hub.js"
import { middlewareUpdateStatus, startMiddlewareUpdate } from "./services/updater.js"
import { isPairingRequiredError } from "./services/commands.js"

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

function packageVersion() {
  for (const file of [path.join(process.cwd(), "package.json"), path.join(process.cwd(), "..", "..", "package.json")]) {
    try {
      const pkg = JSON.parse(fs.readFileSync(file, "utf8"))
      if (pkg.version) return String(pkg.version)
    } catch { /* keep looking */ }
  }
  return "0.1.0"
}

function contentText(content: unknown) {
  if (Array.isArray(content)) {
    return content.map((b:any) => typeof b?.text === "string" ? b.text : "").join("")
  }
  return typeof content === "string" ? content : ""
}

function assistantMessageText(message: any) {
  const text = contentText(message?.content)
  if (text) return text
  if (message?.stopReason === "error" && message?.errorMessage) {
    const raw = String(message.errorMessage)
    const requestId = raw.match(/"request_id"\s*:\s*"([^"]+)"/)?.[1]
    if (message?.provider === "anthropic" && /OAuth authentication is currently not supported/i.test(raw)) {
      return `Claude Opus can’t run right now because Anthropic auth is invalid. Add a direct Anthropic API key or pick another model.${requestId ? ` Request: ${requestId}` : ""}`
    }
    return `Error: ${raw}`
  }
  return ""
}

function emitToolCallsFromContent(send: (event: string, data: unknown) => void, sessionKey: string, content: unknown) {
  if (!Array.isArray(content)) return
  for (const block of content as any[]) {
    if (block?.type !== "toolCall" && block?.type !== "tool_use") continue
    const toolCallId = block.id || block.toolCallId || block.tool_use_id
    const name = block.name
    if (!toolCallId || !name) continue
    send("chat.tool", {
      type: "chat.tool",
      sessionKey,
      phase: "calling",
      toolCallId,
      name,
      args: block.arguments ?? block.input ?? null,
    })
  }
}

function emitToolResultFromMessage(send: (event: string, data: unknown) => void, sessionKey: string, message: any) {
  const role = message?.role
  if (role !== "tool" && role !== "toolResult" && role !== "tool_result") return
  const toolCallId = message.toolCallId || message.tool_call_id || message.toolUseId || message.tool_use_id
  if (!toolCallId) return
  send("chat.tool", {
    type: "chat.tool",
    sessionKey,
    phase: "result",
    toolCallId,
    name: message.name || message.toolName || "unknown",
    result: message.content ?? message.text ?? null,
  })
}

export function createStore(config: MiddlewareConfig) {
  return new Store(config)
}

export function createApp(config: MiddlewareConfig, injectedStore?: Store) {
  const app = express()
  const version = packageVersion()
  app.set("etag", false)
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
  app.use((req, res, next) => {
    if (req.path.includes("/git/") || req.path.startsWith("/api/repos/")) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
      res.setHeader("Pragma", "no-cache")
      res.setHeader("Expires", "0")
      res.removeHeader("ETag")
    }
    next()
  })

  app.get("/health", async (_req, res) => {
    const gatewayConnected = await isOpenClawGatewayReachable(config.openclawGatewayUrl)
    res.json({
      ok: true,
      service: "openclaw-middleware",
      version,
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

  app.get("/api/version", (_req, res) => res.json({ ok: true, version, service: "openclaw-middleware" }))
  app.get("/api/bootstrap", (_req, res) => {
    const spacesPayload = records.spacesList()
    const activeSpaceId = spacesPayload.activeSpaceId ?? spacesPayload.spaces?.[0]?.id ?? null
    res.json({
      ok: true,
      spaces: spacesPayload.spaces,
      activeSpaceId,
      chats: records.chatsList({ archived: false, spaceId: activeSpaceId }).chats,
      projects: projects.list({ spaceId: activeSpaceId }).projects,
      sessions: records.sessionsList({}).sessions,
    })
  })
  app.get("/api/middleware/update/status", (_req, res) => res.json(middlewareUpdateStatus()))
  app.post("/api/middleware/update", (_req, res, next) => { try { res.json(startMiddlewareUpdate()) } catch (error) { next(error) } })
  app.post("/api/commands/:command", async (req, res, next) => { try { res.json(await commands.handle(req.params.command, req.body?.input ?? req.body ?? {})) } catch (error) { next(error) } })
  app.get("/api/migration/telegram/scan", async (req, res, next) => { try { res.json(await commands.handle("middleware_migration_telegram_scan", { limit: req.query.limit ? Number(req.query.limit) : undefined })) } catch (error) { next(error) } })
  app.post("/api/migration/telegram/import", async (req, res, next) => { try { res.json(await commands.handle("middleware_migration_telegram_import", req.body ?? {})) } catch (error) { next(error) } })

  app.get("/api/projects", (req, res) => res.json(projects.list({ spaceId: req.query.spaceId ? String(req.query.spaceId) : undefined })))
  app.post("/api/projects", (req, res) => res.json(projects.create(req.body)))
  app.patch("/api/projects/:projectId", (req, res) => res.json(projects.update(req.params.projectId, req.body)))
  app.delete("/api/projects/:projectId", (req, res) => res.json(projects.delete(req.params.projectId)))

  app.get("/api/topics", (req, res) => res.json(records.topicsList(String(req.query.projectId ?? ""))))
  app.post("/api/topics", (req, res) => res.json(records.topicsCreate(req.body)))
  app.patch("/api/topics/:topicId", (req, res) => res.json(records.topicsUpdate(req.params.topicId, req.body)))
  app.delete("/api/topics/:topicId", (req, res) => res.json(records.topicsDelete(req.params.topicId)))
  app.post("/api/topics/:topicId/archive", (req, res) => res.json(records.topicsArchive(req.params.topicId, req.body?.archived ?? true)))

  app.get("/api/chats", (req, res) => res.json(records.chatsList({ archived: req.query.archived === "true", spaceId: req.query.spaceId ? String(req.query.spaceId) : undefined })))
  app.post("/api/chats", (req, res) => res.json(records.chatsCreate(req.body)))
  app.patch("/api/chats/:chatId", (req, res) => res.json(records.chatsUpdate(req.params.chatId, req.body)))
  app.post("/api/chats/:chatId/rename", (req, res) => res.json(records.chatsRename(req.params.chatId, String(req.body?.name ?? "New Chat"))))
  app.post("/api/chats/:chatId/archive", (req, res) => res.json(records.chatsArchive(req.params.chatId, req.body?.archived ?? true)))
  app.delete("/api/chats/:chatId", (req, res) => res.json(records.chatsDelete(req.params.chatId)))
  app.post("/api/chats/:chatId/session", (req, res) => res.json(records.chatsAttachSession(req.params.chatId, String(req.body?.sessionKey ?? ""))))

  app.get("/api/spaces", (_req, res) => res.json(records.spacesList()))
  app.post("/api/spaces", (req, res) => res.json(records.spacesCreate(req.body)))
  app.patch("/api/spaces/:spaceId", (req, res) => res.json(records.spacesUpdate(req.params.spaceId, req.body)))
  app.post("/api/spaces/:spaceId/switch", (req, res) => res.json(records.spacesSwitch(req.params.spaceId)))
  app.delete("/api/spaces/:spaceId", (req, res) => res.json(records.spacesDelete(req.params.spaceId)))

  app.get("/api/sessions", (req, res) => res.json(records.sessionsList({
    projectId: req.query.projectId ? String(req.query.projectId) : undefined,
    topicId: req.query.topicId ? String(req.query.topicId) : undefined,
  })))
  app.post("/api/sessions", (req, res) => res.json(records.sessionsCreate(req.body)))

  app.get("/api/repos/recent", (_req, res) => res.json(repos.recent()))
  app.post("/api/repos/scan", (_req, res) => res.json(repos.scan()))
  app.post("/api/repos/select", (req, res) => res.json(repos.select(req.body)))
  app.get("/api/repos/git/status", (req, res) => res.json(git.statusForPath(String(req.query.path ?? ""))))
  app.get("/api/repos/git/diff", (req, res) => res.json(git.diffForPath(String(req.query.repoPath ?? ""), String(req.query.path ?? ""))))
  app.get("/api/repos/git/branches", (req, res) => res.json(git.branchesForPath(String(req.query.path ?? ""))))
  app.post("/api/repos/git/checkout", (req, res) => res.json(git.checkoutPath(String(req.body?.repoPath ?? req.body?.path ?? ""), String(req.body?.branch ?? req.body?.branchName ?? ""))))

  app.get("/api/projects/:projectId/git/status", (req, res) => res.json(git.status(req.params.projectId)))
  app.get("/api/projects/:projectId/git/diff", (req, res) => res.json(git.diff(req.params.projectId, String(req.query.path ?? ""))))
  app.get("/api/projects/:projectId/git/branches", (req, res) => res.json(git.branches(req.params.projectId)))
  app.post("/api/projects/:projectId/git/checkout", (req, res) => res.json(git.checkout(req.params.projectId, String(req.body?.branch ?? req.body?.branchName ?? ""))))

  app.get("/api/workspace/tree", (req, res) => res.json(workspace.treeRoot(String(req.query.path ?? ""))))
  app.get("/api/workspace/file", (req, res) => res.json(workspace.readRoot(String(req.query.path ?? ""))))
  app.get("/api/workspace/raw", (req, res) => {
    const raw = workspace.rawRoot(String(req.query.path ?? ""))
    res.type(raw.contentType)
    fs.createReadStream(raw.file).pipe(res)
  })
  app.put("/api/workspace/file", (req, res) => res.json(workspace.writeRoot(String(req.body?.path ?? ""), String(req.body?.content ?? ""))))
  app.get("/api/projects/:projectId/workspace/tree", (req, res) => res.json(workspace.tree(req.params.projectId, String(req.query.path ?? ""))))
  app.get("/api/projects/:projectId/workspace/file", (req, res) => res.json(workspace.read(req.params.projectId, String(req.query.path ?? ""))))
  app.get("/api/projects/:projectId/workspace/raw", (req, res) => {
    const raw = workspace.raw(req.params.projectId, String(req.query.path ?? ""))
    res.type(raw.contentType)
    fs.createReadStream(raw.file).pipe(res)
  })
  app.put("/api/projects/:projectId/workspace/file", (req, res) => res.json(workspace.write(req.params.projectId, String(req.body?.path ?? ""), String(req.body?.content ?? ""))))

  app.post("/api/terminal/spawn", async (req, res, next) => { try { res.json(await terminal.spawnWorkspace(req.body)) } catch (error) { next(error) } })
  app.post("/api/projects/:projectId/terminal/spawn", async (req, res, next) => { try { res.json(await terminal.spawn(req.params.projectId, req.body)) } catch (error) { next(error) } })
  app.post("/api/terminal/:terminalId/write", (req, res) => res.json(terminal.write(req.params.terminalId, String(req.body?.data ?? ""))))
  app.post("/api/terminal/:terminalId/resize", (req, res) => res.json(terminal.resize(req.params.terminalId, Number(req.body?.cols ?? 80), Number(req.body?.rows ?? 24))))
  app.post("/api/terminal/:terminalId/kill", (req, res) => res.json(terminal.kill(req.params.terminalId)))
  app.get("/api/terminal/:terminalId/stream", (req, res) => terminal.stream(req.params.terminalId, res))

  app.get("/api/stream/cron", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    })
    res.write(": cron stream ready\n\n")
    const keepAlive = setInterval(() => res.write(": keepalive\n\n"), 25_000)
    req.on("close", () => clearInterval(keepAlive))
  })

  app.get("/api/stream/chat/:sessionKey", async (req, res, next) => {
    const requestedSessionKey = req.params.sessionKey
    const currentState = (store as any).read?.() ?? {}
    const sessionKey = currentState.commandState?.activeBranchSessions?.[requestedSessionKey] || requestedSessionKey
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    })
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    if (isSharedGatewayEnabled()) {
      const unregister = registerChatStreamClient({ requestedSessionKey, activeSessionKey: sessionKey, res })
      req.on("close", unregister)
      return
    }
    let gateway: Awaited<ReturnType<typeof connectGateway>> | null = null
    send("chat.ready", { type: "chat.ready", sessionKey: requestedSessionKey, activeSessionKey: sessionKey })
    try {
      gateway = await connectGateway(["operator.read", "operator.write", "operator.admin", "operator.approvals"])
      send("chat.status", { type: "chat.status", sessionKey, state: "connected" })
      await gateway.request("sessions.subscribe", {}, 30_000).catch(() => null)
      let closed = false

      const subscribedMessageKeys = new Set<string>()
      const pendingMessageKeys = new Set<string>()
      const subagentKeys = new Set<string>()
      const spawnQueue: string[] = []
      const subagentToSpawn = new Map<string, string>()
      const pendingSubagentKeys: string[] = []
      const seenToolEvents = new Set<string>()

      const isSubagentKey = (key: unknown): key is string => typeof key === "string" && key.includes(":subagent:")
      const matchesSession = (key: unknown) => {
        if (typeof key !== "string") return false
        return key === sessionKey || key === requestedSessionKey || key.endsWith(sessionKey) || subagentKeys.has(key)
      }
      const subscribeMessages = async (key: string) => {
        if (closed || subscribedMessageKeys.has(key) || pendingMessageKeys.has(key)) return
        pendingMessageKeys.add(key)
        const response = await gateway?.request("sessions.messages.subscribe", { key }, 30_000).catch(() => null)
        pendingMessageKeys.delete(key)
        if (response?.ok && (response.payload as any)?.subscribed) subscribedMessageKeys.add(key)
      }
      const emitSpawnLinked = (toolCallId: string, childSessionKey: string) => {
        send("chat.tool", {
          type: "chat.tool",
          sessionKey,
          phase: "spawn_linked",
          name: "sessions_spawn",
          toolCallId,
          result: JSON.stringify({ childSessionKey }),
          subagentOf: null,
        })
      }
      const linkSubagent = (key: string, preferredToolCallId?: string | null) => {
        if (!subagentKeys.has(key)) {
          subagentKeys.add(key)
          void subscribeMessages(key)
        }
        const existing = subagentToSpawn.get(key)
        const toolCallId = existing ?? preferredToolCallId ?? (spawnQueue.length > 0 ? spawnQueue.shift()! : null)
        if (toolCallId && !existing) {
          subagentToSpawn.set(key, toolCallId)
          emitSpawnLinked(toolCallId, key)
        } else if (!toolCallId && !pendingSubagentKeys.includes(key)) {
          pendingSubagentKeys.push(key)
        }
      }
      const extractSubagentKey = (value: unknown) => {
        const text = typeof value === "string" ? value : (() => { try { return JSON.stringify(value) } catch { return "" } })()
        const jsonMatch = text.match(/"childSessionKey"\s*:\s*"([^"]+:subagent:[^"]+)"/)
        if (jsonMatch?.[1]) return jsonMatch[1]
        const contextMatch = text.match(/session_key:\s*(agent:[^\s]+:subagent:[^\s]+)/)
        if (contextMatch?.[1]) return contextMatch[1]
        const genericMatch = text.match(/(agent:[^\s"']+:subagent:[^\s"']+)/)
        return genericMatch?.[1] ?? null
      }

      await subscribeMessages(sessionKey)
      const retryParentSubscribe = setInterval(() => {
        if (subscribedMessageKeys.has(sessionKey)) {
          clearInterval(retryParentSubscribe)
          return
        }
        void subscribeMessages(sessionKey)
      }, 1_000)
      const stopRetrySubscribe = () => {
        closed = true
        clearInterval(retryParentSubscribe)
      }
      const off = gateway.on((message) => {
        if (message.type !== "event") return
        const payload = message.payload as any

        if (message.event === "session.created" || message.event === "sessions.update") {
          const key = payload?.key ?? payload?.sessionKey
          if (isSubagentKey(key)) linkSubagent(key)
        }

        if (message.event === "session.message" && payload?.message) {
          if (!matchesSession(payload.sessionKey)) return
          const content = payload.message.content
          const messageSessionKey = payload.sessionKey ?? sessionKey
          const childKeyFromContent = extractSubagentKey(content)
          if (childKeyFromContent) linkSubagent(childKeyFromContent)
          if (payload.message.role === "user") {
            const announceText = contentText(content)
            const childKey = extractSubagentKey(announceText)
            const spawnToolCallId = childKey ? subagentToSpawn.get(childKey) : null
            if (spawnToolCallId && announceText.includes("<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>")) {
              send("chat.tool", {
                type: "chat.tool",
                sessionKey,
                phase: "spawn_done",
                name: "sessions_spawn",
                toolCallId: spawnToolCallId,
                result: null,
                error: /status:\s*(error|failed)/.test(announceText) ? "subagent_error" : null,
                subagentOf: null,
              })
            }
            return
          }
          if (isSubagentKey(messageSessionKey)) return
          const text = assistantMessageText(payload.message)
          if (payload.message.role === "assistant") {
            emitToolCallsFromContent(send, sessionKey, content)
            send("chat.message", { type: "chat.message", sessionKey, messageId: payload.message.id ?? payload.messageId ?? null, role: payload.message.role, content, text, createdAt: payload.message.createdAt ?? null, model: payload.message.model ?? null, usage: payload.message.usage ?? null, stopReason: payload.message.stopReason ?? null })
            send("chat.status", { type: "chat.status", sessionKey, state: text ? "done" : "streaming" })
          } else {
            emitToolResultFromMessage(send, sessionKey, payload.message)
            const childKey = extractSubagentKey(content ?? payload.message)
            if (childKey) linkSubagent(childKey)
          }
        } else if (message.event === "chat") {
          if (payload?.sessionKey && !matchesSession(payload.sessionKey)) return
          if (isSubagentKey(payload?.sessionKey)) return
          const state = payload?.state
          const content = payload?.message?.content
          const text = assistantMessageText(payload?.message)
          emitToolCallsFromContent(send, sessionKey, content)
          if (text) send("chat.message", { type: "chat.message", sessionKey, messageId: payload?.runId ?? null, role: "assistant", content, text, createdAt: null, model: payload?.message?.model ?? null, usage: state === "final" ? payload?.usage ?? null : null, stopReason: state === "final" ? payload?.stopReason ?? null : null })
          if (state === "final") send("chat.status", { type: "chat.status", sessionKey, state: "done" })
          if (state === "error") send("chat.status", { type: "chat.status", sessionKey, state: "error" })
        } else if (message.event === "session.tool" && payload?.data) {
          if (isSubagentKey(payload.sessionKey)) linkSubagent(payload.sessionKey)
          if (!matchesSession(payload.sessionKey)) return

          const data = payload.data
          if (data?.name === "sessions_spawn" && data?.phase === "start" && data?.toolCallId) {
            if (pendingSubagentKeys.length > 0) {
              const pendingKey = pendingSubagentKeys.shift()!
              linkSubagent(pendingKey, data.toolCallId)
            } else if (!spawnQueue.includes(data.toolCallId)) {
              spawnQueue.push(data.toolCallId)
            }
          }

          const isSubagent = isSubagentKey(payload.sessionKey)
          const spawnToolCallId = isSubagent ? subagentToSpawn.get(payload.sessionKey) : null
          const eventKey = [payload.sessionKey ?? sessionKey, payload.runId ?? "run", payload.seq ?? data?.toolCallId ?? "tool", data?.phase ?? "phase"].join(":")
          if (seenToolEvents.has(eventKey)) return
          seenToolEvents.add(eventKey)

          send("chat.tool", {
            type: "chat.tool",
            sessionKey,
            runId: payload.runId ?? null,
            verboseLevel: payload.verboseLevel ?? null,
            phase: data?.phase ?? null,
            name: data?.name ?? null,
            toolCallId: data?.toolCallId ?? null,
            args: data?.args ?? null,
            partialResult: data?.partialResult ?? null,
            result: data?.result ?? null,
            error: data?.error ?? null,
            isError: data?.isError ?? null,
            subagentOf: spawnToolCallId ? `spawn:${spawnToolCallId}` : null,
          })
          if (!isSubagent) {
            send("chat.status", {
              type: "chat.status",
              sessionKey,
              state: data?.phase === "error" ? "error" : data?.phase === "result" ? "thinking" : "tool_running",
              label: data?.name ?? null,
            })
          }
        } else if (message.event === "agent") {
          const eventSessionKey = payload?.sessionKey
          if (isSubagentKey(eventSessionKey)) linkSubagent(eventSessionKey)
        }
      })
      req.on("close", () => { stopRetrySubscribe(); off(); gateway?.close() })
    } catch (error) {
      const label = isPairingRequiredError(error)
        ? "pairing required"
        : error instanceof Error
          ? error.message
          : "stream_error"
      send("chat.status", { type: "chat.status", sessionKey, state: "error", label })
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
