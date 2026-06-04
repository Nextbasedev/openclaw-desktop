import express from "express"
import { handleCommand } from "./dispatch/handler.js"
import { chatStreamHandler } from "./sse/chat.js"
import { terminalStreamHandler } from "./sse/terminal.js"
import { ptyStreamHandler } from "./sse/pty.js"
import { cronStreamHandler } from "./sse/cron.js"
import { startCronEventListener } from "./services/cron-events.service.js"
import * as workspaceHttp from "./services/workspace-http.service.js"
import { connectGateway } from "./gateway/client.js"
import { startSyncEngine } from "./sync/engine.js"
import { inboundChatMediaRoute } from "middleware"

const app: express.Express = express()
const PORT = parseInt(process.env.JARVIS_SERVER_PORT ?? "4000", 10)
const JSON_BODY_LIMIT = "150mb"

app.use(express.json({ limit: JSON_BODY_LIMIT }))

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization")
  if (req.method === "OPTIONS") {
    res.sendStatus(204)
    return
  }
  next()
})

app.post("/api/ipc/:command", handleCommand)

app.get("/api/chat/media/inbound/:id", (req, res, next) => {
  inboundChatMediaRoute(req, res).catch(next)
})

app.get("/api/my/workspace/tree", (req, res, next) => {
  workspaceHttp.workspaceTreeRoute(req, res).catch(next)
})
app.get("/api/my/workspace/capabilities", (req, res, next) => {
  workspaceHttp.workspaceCapabilitiesRoute(req, res).catch(next)
})
app.get(/^\/api\/my\/workspace\/stat\/(.+)$/, (req, res, next) => {
  workspaceHttp.workspaceStatRoute(req, res).catch(next)
})
app.get(/^\/api\/my\/workspace\/files\/(.+)$/, (req, res, next) => {
  workspaceHttp.workspaceReadRoute(req, res).catch(next)
})
app.put(/^\/api\/my\/workspace\/files\/(.+)$/, (req, res, next) => {
  workspaceHttp.workspaceWriteRoute(req, res).catch(next)
})
app.delete(/^\/api\/my\/workspace\/files\/(.+)$/, (req, res, next) => {
  workspaceHttp.workspaceDeleteRoute(req, res).catch(next)
})
app.post("/api/my/workspace/mkdir", (req, res, next) => {
  workspaceHttp.workspaceCreateDirectoryRoute(req, res).catch(next)
})
app.post("/api/my/workspace/move", (req, res, next) => {
  workspaceHttp.workspaceMoveRoute(req, res).catch(next)
})
app.get(/^\/api\/my\/workspace\/download\/(.+)$/, (req, res, next) => {
  workspaceHttp.workspaceDownloadRoute(req, res).catch(next)
})

app.get("/api/stream/chat/:sessionKey", chatStreamHandler)
app.get("/api/stream/terminal/:sessionKey", terminalStreamHandler)
app.get("/api/stream/pty/:ptyId", ptyStreamHandler)
app.get("/api/stream/cron", cronStreamHandler)

app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() })
})

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err)
  res.status(500).json({ error: message })
})

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Jarvis server listening on http://127.0.0.1:${PORT}`)
    startSyncEngine()
    connectGateway()
      .then(() => {
        console.log("Gateway connected")
        return startCronEventListener()
      })
      .then(() => console.log("Cron event listener started"))
      .catch((err) => {
        console.log("Gateway not available at startup:", err?.message)
        startCronEventListener().catch(() => {})
      })
  })
}

export { app }
