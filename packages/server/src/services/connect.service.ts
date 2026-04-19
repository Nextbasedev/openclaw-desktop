import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { connectToOpenClawGateway } from "middleware"

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

export function connectStatus() {
  const configPath = path.join(
    os.homedir(),
    ".openclaw",
    "openclaw.json",
  )
  let gatewayUrl = null
  try {
    const raw = JSON.parse(
      fs.readFileSync(configPath, "utf-8"),
    )
    gatewayUrl = raw.gateway_url ?? null
  } catch {}

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
    hasIdentity,
    status:
      gatewayUrl && hasIdentity ? "ready" : "not_configured",
  }
}

export async function connectTest() {
  const status = connectStatus()
  if (status.status !== "ready") {
    return {
      ok: false,
      error:
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

    return { ok: false, error: msg, isLocal: local }
  }
}

export function connectReset() {
  return {
    ok: true,
    message:
      "Connection state reset. Re-run onboarding to reconfigure.",
  }
}
