import express from "express"
import cors from "cors"
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

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "openclaw-middleware",
      version: "0.1.0",
      host: config.host,
      openclaw: { gatewayUrl: config.openclawGatewayUrl },
    })
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

  app.use((req, _res, next) => next(new HttpError(404, `Route not found: ${req.method} ${req.path}`, "NOT_FOUND")))

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = error instanceof HttpError ? error.status : 500
    const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR"
    const message = error instanceof Error ? error.message : "Unknown error"
    res.status(status).json({ ok: false, error: { code, message } })
  })

  return app
}
