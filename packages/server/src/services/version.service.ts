import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { ensureGatewayClient } from "../gateway/client.js"

type VersionInfo = {
  version: string
  nodeVersion: string
  openclawVersion: string | null
  source: "gateway" | "config" | "unknown"
}

function readOpenClawVersion(): string | null {
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json")
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
    const version = raw?.meta?.lastTouchedVersion
    if (typeof version === "string" && version) {
      return version
    }
  } catch { /* ignore */ }

  return null
}

async function readGatewayVersion(): Promise<string | null> {
  try {
    const client = await ensureGatewayClient()
    const version = (client as { server?: { version?: string } }).server?.version
    return typeof version === "string" && version ? version : null
  } catch {
    return null
  }
}

export async function versionInfo(): Promise<VersionInfo> {
  const nodeVersion = process.versions.node
  const gatewayVersion = await readGatewayVersion()
  const configVersion = readOpenClawVersion()
  const openclawVersion = gatewayVersion ?? configVersion

  return {
    version: openclawVersion ?? "unknown",
    nodeVersion,
    openclawVersion,
    source: gatewayVersion ? "gateway" : configVersion ? "config" : "unknown",
  }
}
