import express from "express"
import { handleCommand } from "./dispatch/handler.js"
import { chatStreamHandler } from "./sse/chat.js"
import { terminalStreamHandler } from "./sse/terminal.js"
import { ptyStreamHandler } from "./sse/pty.js"

const app = express()
const PORT = parseInt(process.env.JARVIS_SERVER_PORT ?? "3001", 10)

app.use(express.json({ limit: "100mb" }))

app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*")
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
  res.header("Access-Control-Allow-Headers", "Content-Type")
  next()
})

app.post("/api/ipc/:command", handleCommand)

app.get("/api/stream/chat/:sessionKey", chatStreamHandler)
app.get("/api/stream/terminal/:sessionKey", terminalStreamHandler)
app.get("/api/stream/pty/:ptyId", ptyStreamHandler)

app.get("/health", (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() })
})

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, "127.0.0.1", () => {
    console.log(`Jarvis server listening on http://127.0.0.1:${PORT}`)
  })
}

export { app }
