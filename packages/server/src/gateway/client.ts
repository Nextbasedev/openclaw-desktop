import { EventEmitter } from "node:events"
import {
  connectToOpenClawGateway,
  type OpenClawGatewayClient,
} from "middleware"

const SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.admin",
] as const

const CLIENT_IDENTITY = {
  id: "openclaw-tui",
  displayName: "Jarvis Middleware",
  version: "0.0.1",
  platform: "desktop",
  mode: "cli",
}

const RECONNECT_DELAY_MS = 3_000
const MAX_RECONNECT_DELAY_MS = 30_000

let singleton: OpenClawGatewayClient | null = null
let connecting: Promise<OpenClawGatewayClient> | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectDelay = RECONNECT_DELAY_MS

export const gatewayEvents = new EventEmitter()

function clearReconnectTimer() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
}

function scheduleReconnect() {
  clearReconnectTimer()
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectGateway().catch(() => {
      reconnectDelay = Math.min(
        reconnectDelay * 2,
        MAX_RECONNECT_DELAY_MS,
      )
      scheduleReconnect()
    })
  }, reconnectDelay)
}

function attachSocketListeners(client: OpenClawGatewayClient) {
  const ws = client.socket
  ws.addEventListener("close", () => {
    if (singleton === client) {
      singleton = null
      connecting = null
      gatewayEvents.emit("disconnected")
      scheduleReconnect()
    }
  })
  ws.addEventListener("error", () => {
    if (singleton === client) {
      singleton = null
      connecting = null
      gatewayEvents.emit("error")
      scheduleReconnect()
    }
  })
}

export async function connectGateway(): Promise<OpenClawGatewayClient> {
  if (singleton && singleton.socket.readyState === WebSocket.OPEN) {
    return singleton
  }

  if (connecting) {
    return connecting
  }

  connecting = (async () => {
    try {
      const client = await connectToOpenClawGateway({
        scopes: SCOPES,
        client: CLIENT_IDENTITY,
      })
      singleton = client
      reconnectDelay = RECONNECT_DELAY_MS
      attachSocketListeners(client)
      gatewayEvents.emit("connected")
      return client
    } catch (error) {
      connecting = null
      throw error
    }
  })()

  return connecting
}

export function getGatewayClient(): OpenClawGatewayClient {
  if (!singleton || singleton.socket.readyState !== WebSocket.OPEN) {
    throw new Error(
      "Gateway not connected. Start the OpenClaw Gateway first.",
    )
  }
  return singleton
}

export async function ensureGatewayClient(): Promise<OpenClawGatewayClient> {
  if (singleton && singleton.socket.readyState === WebSocket.OPEN) {
    return singleton
  }
  try {
    return await connectGateway()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Gateway not connected. ${message || "Start the OpenClaw Gateway first."}`,
    )
  }
}

export function disconnectGateway() {
  clearReconnectTimer()
  if (singleton) {
    singleton.close()
    singleton = null
  }
  connecting = null
}

export function isGatewayConnected(): boolean {
  return singleton !== null && singleton.socket.readyState === WebSocket.OPEN
}
