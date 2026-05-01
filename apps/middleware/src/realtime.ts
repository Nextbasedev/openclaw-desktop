import type { Server } from "node:http"
import { WebSocketServer } from "ws"
import type { MiddlewareConfig } from "./config.js"
import type { Store } from "./services/store.js"
import { terminalRoutes } from "./services/terminal.js"

function tokenFromRequest(url: URL, protocol: string | undefined) {
  const fromQuery = url.searchParams.get("token")
  if (fromQuery) return fromQuery
  if (protocol?.startsWith("token.")) return protocol.slice("token.".length)
  return null
}

export function attachRealtime(server: Server, config: MiddlewareConfig, store: Store) {
  const terminal = terminalRoutes(store)
  const wss = new WebSocketServer({ noServer: true })

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`)
    const match = url.pathname.match(/^\/api\/terminal\/([^/]+)\/ws$/)
    if (!match?.[1]) return
    const token = tokenFromRequest(url, req.headers["sec-websocket-protocol"] as string | undefined)
    if (token !== config.token) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n")
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      try {
        terminal.attachWebSocket(match[1], ws, req)
      } catch {
        ws.close(1011, "terminal unavailable")
      }
    })
  })
}
