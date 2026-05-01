import crypto from "node:crypto"
import os from "node:os"
import path from "node:path"

export type MiddlewareConfig = {
  host: string
  port: number
  token: string
  databasePath: string
  openclawGatewayUrl: string
  workspaceRoot: string
  nodeEnv: string
  pairingCode: string
}

function defaultDatabasePath() {
  return path.join(os.homedir(), ".openclaw", "middleware", "middleware.db")
}

function defaultWorkspaceRoot() {
  return path.join(os.homedir(), ".openclaw", "workspace")
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MiddlewareConfig {
  const nodeEnv = env.NODE_ENV ?? "development"
  const token = env.MIDDLEWARE_TOKEN || (nodeEnv === "test" ? "test-token" : "")
  if (!token && nodeEnv !== "development") {
    throw new Error("MIDDLEWARE_TOKEN is required")
  }

  return {
    host: env.HOST ?? "127.0.0.1",
    port: Number(env.PORT ?? 8787),
    token: token || crypto.randomBytes(24).toString("hex"),
    databasePath: env.MIDDLEWARE_DB ?? defaultDatabasePath(),
    openclawGatewayUrl: env.OPENCLAW_GATEWAY_URL ?? "ws://127.0.0.1:18789",
    workspaceRoot: env.WORKSPACE_ROOT ?? defaultWorkspaceRoot(),
    nodeEnv,
    pairingCode: env.MIDDLEWARE_PAIRING_CODE || crypto.randomBytes(3).toString("hex").toUpperCase(),
  }
}
