import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { ensureGatewayClient } from "../gateway/client.js"

type ModelCatalogEntry = {
  id: string
  name: string
  provider: string
  alias?: string
  contextWindow?: number
  reasoning?: boolean
  input?: Array<"text" | "image" | "document">
}

type ModelAuthExpiry = {
  at: number
  remainingMs: number
  label: string
}

type ModelAuthStatusProvider = {
  provider: string
  displayName?: string
  status: string
  expiry?: ModelAuthExpiry
  profiles?: Array<{
    profileId: string
    type: string
    status: string
    expiry?: ModelAuthExpiry
  }>
  usage?: {
    windows?: Array<{
      label: string
      usedPercent: number
      resetAt?: number
    }>
    plan?: string
  }
}

function wrapGatewayError(error: unknown): never {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (
      msg.includes("enoent") ||
      msg.includes("token is missing") ||
      msg.includes("websocket") ||
      msg.includes("timeout") ||
      msg.includes("connect")
    ) {
      throw new Error(
        "Gateway not connected. Start the OpenClaw Gateway first.",
      )
    }
  }
  throw error
}

function openclawConfigPath(): string {
  return path.join(os.homedir(), ".openclaw", "openclaw.json")
}

function readOpenclawConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(openclawConfigPath(), "utf-8")
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeOpenclawConfig(
  config: Record<string, unknown>,
): void {
  const configPath = openclawConfigPath()
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n")
}

function setJsonPath(
  root: Record<string, unknown>,
  jsonPath: string,
  value: unknown,
): void {
  const parts = jsonPath.split(".").filter((p) => p.length > 0)
  if (parts.length === 0) return
  let current: Record<string, unknown> = root
  for (const part of parts.slice(0, -1)) {
    if (
      typeof current[part] !== "object" ||
      current[part] === null ||
      Array.isArray(current[part])
    ) {
      current[part] = {}
    }
    current = current[part] as Record<string, unknown>
  }
  current[parts[parts.length - 1]] = value
}

function valueAtJsonPath(
  root: Record<string, unknown>,
  jsonPath: string,
): unknown {
  const parts = jsonPath.split(".").filter((p) => p.length > 0)
  let current: unknown = root
  for (const part of parts) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    )
      return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

export async function modelsList() {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      models: ModelCatalogEntry[]
    }>("models.list", {})
    if (!res.ok) {
      throw new Error(res.error?.message ?? "models.list failed")
    }
    const config = readOpenclawConfig()
    const currentModel =
      (valueAtJsonPath(
        config,
        "agents.defaults.model.primary",
      ) as string) ?? null
    return {
      models: res.payload?.models ?? [],
      currentModel,
    }
  } catch (error) {
    wrapGatewayError(error)
  }
}

export async function modelsAuthStatus() {
  try {
    const gw = await ensureGatewayClient()
    const res = await gw.request<{
      ts: number
      providers: ModelAuthStatusProvider[]
    }>("models.authStatus", {})
    if (!res.ok) {
      throw new Error(
        res.error?.message ?? "models.authStatus failed",
      )
    }
    return res.payload
  } catch (error) {
    wrapGatewayError(error)
  }
}

export function modelsSetDefault(input: { modelId: string }) {
  const config = readOpenclawConfig()
  const previousModel =
    (valueAtJsonPath(
      config,
      "agents.defaults.model.primary",
    ) as string) ?? null

  setJsonPath(config, "agents.defaults.model.primary", input.modelId)
  writeOpenclawConfig(config)

  return {
    ok: true,
    model: input.modelId,
    previousModel,
  }
}
