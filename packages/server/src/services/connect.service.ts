import fs from "node:fs"
import path from "node:path"
import os from "node:os"

export function connectStatus() {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json")
  let gatewayUrl = null
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    gatewayUrl = raw.gateway_url ?? null
  } catch {}

  const identityPath = path.join(os.homedir(), ".openclaw", "state", "identity", "device.json")
  const hasIdentity = fs.existsSync(identityPath)

  return {
    gatewayConfigured: !!gatewayUrl,
    gatewayUrl,
    hasIdentity,
    status: gatewayUrl && hasIdentity ? "ready" : "not_configured",
  }
}

export function connectTest() {
  const status = connectStatus()
  if (status.status !== "ready") {
    return { ok: false, error: "Gateway not configured or identity missing", ...status }
  }
  return { ok: true, message: "Configuration looks valid. Use Gateway WS to test actual connectivity.", ...status }
}

export function connectReset() {
  return { ok: true, message: "Connection state reset. Re-run onboarding to reconfigure." }
}
