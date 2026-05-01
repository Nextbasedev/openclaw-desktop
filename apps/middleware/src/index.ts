import http from "node:http"
import { createApp, createStore } from "./app.js"
import { loadConfig } from "./config.js"
import { attachRealtime } from "./realtime.js"

const config = loadConfig()
const store = createStore(config)
const app = createApp(config, store)
const server = http.createServer(app)
attachRealtime(server, config, store)

server.listen(config.port, config.host, () => {
  console.log(`OpenClaw Middleware listening on http://${config.host}:${config.port}`)
})
