import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { connectToOpenClawGateway } from "middleware"
import { connectGateway, disconnectGateway } from "../gateway/client.js"
import { getDb } from "../db/connection.js"
import { stopSyncEngine, startSyncEngine } from "../sync/engine.js"
import { forceBackfill } from "../sync/backfill.js"

const SCOPES = [
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.admin",
] as const

function openclawConfigPath(): string {
  return path.join(os.homedir(), ".openclaw", "openclaw.json")
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(
      fs.readFileSync(openclawConfigPath(), "utf-8"),
    ) as Record<string, unknown>
  } catch {
    return {}
  }
}

function isLocalGateway(gatewayUrl: string): boolean {
  try {
    const url = new URL(
      gatewayUrl
        .replace("ws://", "http://")
        .replace("wss://", "https://"),
    )
    const host = url.hostname
    return (
      host === "127.0.0.1" ||
      host === "localhost" ||
      host === "::1" ||
      host === "0.0.0.0"
    )
  } catch {
    return false
  }
}

function isTailscaleIp(gatewayUrl: string): boolean {
  try {
    const url = new URL(
      gatewayUrl
        .replace("ws://", "http://")
        .replace("wss://", "https://"),
    )
    const parts = url.hostname.split(".")
    if (parts.length !== 4) return false
    const first = Number(parts[0])
    const second = Number(parts[1])
    return first === 100 && second >= 64 && second <= 127
  } catch {
    return false
  }
}

function classifyError(
  msg: string,
  gatewayUrl: string,
): { code: string; title: string } {
  const lower = msg.toLowerCase()

  if (lower.includes("origin not allowed"))
    return {
      code: "origin_not_allowed",
      title: "Origin Not Allowed",
    }
  if (
    lower.includes("device identity mismatch") ||
    lower.includes("identity mismatch")
  )
    return {
      code: "identity_mismatch",
      title: "Device Identity Mismatch",
    }
  if (lower.includes("token is missing"))
    return {
      code: "token_missing",
      title: "Authentication Token Missing",
    }
  if (
    lower.includes("invalid token") ||
    lower.includes("unauthorized") ||
    lower.includes("forbidden") ||
    lower.includes("auth failed") ||
    lower.includes("authentication failed") ||
    lower.includes("invalid credentials")
  )
    return {
      code: "token_invalid",
      title: "Authentication Failed",
    }
  if (lower.includes("econnrefused"))
    return {
      code: "gateway_not_running",
      title: "Gateway Not Running",
    }
  if (
    lower.includes("enotfound") ||
    lower.includes("getaddrinfo")
  ) {
    if (isTailscaleIp(gatewayUrl))
      return {
        code: "tailscale_unreachable",
        title: "Tailscale Network Unreachable",
      }
    return { code: "dns_failed", title: "Host Not Found" }
  }
  if (
    lower.includes("etimedout") ||
    lower.includes("ehostunreach") ||
    lower.includes("enetunreach")
  ) {
    if (isTailscaleIp(gatewayUrl))
      return {
        code: "tailscale_unreachable",
        title: "Tailscale Network Unreachable",
      }
    return {
      code: "network_timeout",
      title: "Network Unreachable",
    }
  }
  if (
    lower.includes("websocket open timeout") ||
    lower.includes("websocket failed")
  )
    return {
      code: "gateway_not_responding",
      title: "Gateway Not Responding",
    }
  if (lower.includes("timeout waiting for connect.challenge"))
    return {
      code: "protocol_error",
      title: "Gateway Protocol Error",
    }
  if (lower.includes("timeout waiting for connect response"))
    return {
      code: "connect_timeout",
      title: "Connection Timeout",
    }
  if (
    lower.includes("protocol") &&
    lower.includes("version")
  )
    return {
      code: "protocol_mismatch",
      title: "Protocol Version Mismatch",
    }
  if (
    lower.includes("econnreset") ||
    lower.includes("socket hang up")
  )
    return {
      code: "connection_reset",
      title: "Connection Reset by Gateway",
    }
  if (
    lower.includes("self-signed") ||
    lower.includes("certificate") ||
    lower.includes("ssl") ||
    lower.includes("cert_")
  )
    return {
      code: "tls_error",
      title: "TLS/SSL Certificate Error",
    }
  if (
    lower.includes("scope") &&
    (lower.includes("denied") || lower.includes("insufficient"))
  )
    return {
      code: "scope_denied",
      title: "Insufficient Permissions",
    }
  if (
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests") ||
    lower.includes("429")
  )
    return {
      code: "rate_limited",
      title: "Rate Limited",
    }
  if (
    lower.includes("max connections") ||
    lower.includes("too many connections") ||
    lower.includes("connection limit")
  )
    return {
      code: "max_connections",
      title: "Too Many Connections",
    }
  if (
    lower.includes("shutting down") ||
    lower.includes("unavailable") ||
    lower.includes("maintenance")
  )
    return {
      code: "server_unavailable",
      title: "Gateway Unavailable",
    }
  if (
    lower.includes("unknown device") ||
    lower.includes("device not registered") ||
    lower.includes("device not found") ||
    lower.includes("not paired")
  )
    return {
      code: "device_not_registered",
      title: "Device Not Registered",
    }
  if (
    lower.includes("token expired") ||
    lower.includes("token has expired")
  )
    return {
      code: "token_expired",
      title: "Token Expired",
    }
  if (
    lower.includes("eperm") ||
    lower.includes("eacces") ||
    lower.includes("permission denied")
  )
    return {
      code: "permission_denied",
      title: "File Permission Denied",
    }
  if (
    lower.includes("unexpected token") ||
    (lower.includes("json") && lower.includes("parse"))
  )
    return {
      code: "config_corrupt",
      title: "Configuration File Corrupt",
    }
  return { code: "unknown", title: "Connection Failed" }
}

function addAllowedOrigins(gatewayUrl: string) {
  const config = readConfig()
  const gw = (config.gateway as Record<string, unknown>) ?? {}
  const controlUi =
    (gw.controlUi as Record<string, unknown>) ?? {}
  const existing =
    (controlUi.allowedOrigins as string[]) ?? []

  const origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "tauri://localhost",
  ]

  const merged = [...new Set([...existing, ...origins])]
  controlUi.allowedOrigins = merged
  gw.controlUi = controlUi
  config.gateway = gw
  fs.writeFileSync(
    openclawConfigPath(),
    JSON.stringify(config, null, 2),
  )
  return merged
}

function resolveGatewayUrl(config: Record<string, unknown>): string | null {
  const explicit = config.gateway_url as string | undefined
  if (explicit) return explicit

  const gw = (config.gateway as Record<string, unknown>) ?? {}
  const port = gw.port as number | undefined
  if (port) {
    const mode = (gw.mode as string) ?? "local"
    const host = mode === "local" ? "127.0.0.1" : "0.0.0.0"
    return `ws://${host}:${port}`
  }

  return null
}

export function connectStatus() {
  const config = readConfig()
  const gatewayUrl = resolveGatewayUrl(config)
  const gw = (config.gateway as Record<string, unknown>) ?? {}
  const auth = (gw.auth as Record<string, unknown>) ?? {}
  const token = (auth.token as string) ?? null

  const identityPath = path.join(
    os.homedir(),
    ".openclaw",
    "state",
    "identity",
    "device.json",
  )
  const hasIdentity = fs.existsSync(identityPath)

  return {
    gatewayConfigured: !!gatewayUrl,
    gatewayUrl,
    gatewayToken: token,
    hasIdentity,
    isLocal: gatewayUrl ? isLocalGateway(gatewayUrl) : true,
    status:
      gatewayUrl && hasIdentity ? "ready" : "not_configured",
  }
}

export async function connectTest() {
  const status = connectStatus()
  if (status.status !== "ready") {
    return {
      ok: false,
      error: "config_not_ready",
      errorTitle: "Configuration Incomplete",
      message:
        "Gateway not configured or identity missing",
      ...status,
    }
  }

  const gatewayUrl = status.gatewayUrl!
  const local = isLocalGateway(gatewayUrl)

  try {
    const client = await connectToOpenClawGateway({
      scopes: [...SCOPES],
    })
    const url = client.gatewayUrl
    client.close()
    return {
      ok: true,
      url,
      message: "Connected successfully",
      isLocal: local,
    }
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : String(err)

    if (msg.includes("origin not allowed")) {
      if (local) {
        const added = addAllowedOrigins(gatewayUrl)
        return {
          ok: false,
          error: "origin_fixed_restart",
          message:
            "Origin access has been configured automatically. Please restart your gateway and try again.",
          isLocal: true,
          addedOrigins: added,
        }
      }
      return {
        ok: false,
        error: "origin_not_allowed",
        isLocal: false,
        message:
          "The remote gateway is blocking this app's origin. Add allowed origins on the gateway server.",
        fix: {
          description:
            'Add the following to your gateway\'s openclaw.json under "gateway.controlUi.allowedOrigins"',
          origins: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "tauri://localhost",
          ],
          example: {
            gateway: {
              controlUi: {
                allowedOrigins: [
                  "http://localhost:3000",
                  "http://127.0.0.1:3000",
                  "tauri://localhost",
                ],
              },
            },
          },
        },
      }
    }

    const classified = classifyError(msg, gatewayUrl)
    return {
      ok: false,
      error: classified.code,
      errorTitle: classified.title,
      message: msg,
      isLocal: local,
      isTailscale: isTailscaleIp(gatewayUrl),
    }
  }
}

export function connectDisconnect() {
  stopSyncEngine()
  disconnectGateway()

  const db = getDb()
  db.exec(`
    DELETE FROM chats;
    DELETE FROM session_mappings;
    DELETE FROM topics;
    DELETE FROM projects;
    DELETE FROM anchor_sessions;
    DELETE FROM sync_outbox;
    DELETE FROM sync_tombstones;
    DELETE FROM app_settings WHERE key LIKE 'sync.%';
  `)

  const configPath = openclawConfigPath()
  const config = readConfig()
  const gw = (config.gateway as Record<string, unknown>) ?? {}
  const auth = (gw.auth as Record<string, unknown>) ?? {}
  delete auth.token
  gw.auth = auth
  delete gw.port
  delete gw.mode
  delete gw.bind
  config.gateway = gw
  delete config.gateway_url

  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
  } catch {}

  return { ok: true, message: "Disconnected from gateway." }
}

export async function connectBootstrap() {
  try {
    await connectGateway()
  } catch {
    // gateway may not be reachable yet; sync engine will retry
  }
  startSyncEngine()
  forceBackfill()
  return { ok: true }
}

export function connectReset() {
  return {
    ok: true,
    message:
      "Connection state reset. Re-run onboarding to reconfigure.",
  }
}
