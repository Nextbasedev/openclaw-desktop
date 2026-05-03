import { connectToOpenClawGateway } from "./index.js"

export type GatewayWorkspaceEntry = {
  name: string
  path: string
  type: "file" | "directory"
  size: number
  modifiedAt?: string
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeWorkspacePath(value: string | undefined): string {
  const trimmed = value?.trim() ?? ""
  if (!trimmed || trimmed === ".") return ""
  return trimmed.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
}

function relativeWorkspacePath(rawPath: string, workspaceRoot: string): string {
  const normalizedPath = rawPath.replace(/\\/g, "/").trim()
  const normalizedRoot = workspaceRoot.replace(/\\/g, "/").trim()
  if (!normalizedPath) return ""
  if (!normalizedRoot) return normalizeWorkspacePath(normalizedPath)
  if (normalizedPath === normalizedRoot) return ""
  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizeWorkspacePath(
      normalizedPath.slice(normalizedRoot.length + 1),
    )
  }
  return normalizeWorkspacePath(normalizedPath)
}

function entryName(pathValue: string, fallback?: string) {
  if (fallback?.trim()) return fallback.trim()
  const normalized = normalizeWorkspacePath(pathValue)
  if (!normalized) return ""
  const parts = normalized.split("/")
  return parts[parts.length - 1] ?? normalized
}

function toWorkspaceEntry(
  value: unknown,
  workspaceRoot: string,
): GatewayWorkspaceEntry | null {
  const row = asRecord(value)
  if (!row) return null

  const rawPath =
    typeof row.path === "string"
      ? row.path
      : typeof row.filePath === "string"
        ? row.filePath
        : typeof row.relativePath === "string"
          ? row.relativePath
          : typeof row.id === "string"
            ? row.id
            : ""

  const normalizedPath = relativeWorkspacePath(rawPath, workspaceRoot)
  const typeHint =
    typeof row.type === "string"
      ? row.type
      : typeof row.kind === "string"
        ? row.kind
        : typeof row.nodeType === "string"
          ? row.nodeType
          : ""

  const directory =
    row.isDir === true ||
    row.isDirectory === true ||
    typeHint === "dir" ||
    typeHint === "directory" ||
    typeHint === "folder"

  const name = entryName(
    normalizedPath,
    typeof row.name === "string" ? row.name : undefined,
  )

  if (!name && !normalizedPath) return null

  return {
    name,
    path: normalizedPath || name,
    type: directory ? "directory" : "file",
    size: typeof row.size === "number" ? row.size : 0,
    modifiedAt:
      typeof row.modifiedAt === "string"
        ? row.modifiedAt
        : typeof row.mtime === "string"
          ? row.mtime
          : typeof row.updatedAt === "string"
            ? row.updatedAt
            : typeof row.updatedAtMs === "number"
              ? new Date(row.updatedAtMs).toISOString()
              : undefined,
  }
}

function extractEntryList(payload: unknown): GatewayWorkspaceEntry[] {
  const record = asRecord(payload)
  if (!record) return []
  const workspaceRoot =
    typeof record.workspace === "string" ? record.workspace : ""
  const list =
    (Array.isArray(record.entries) && record.entries) ||
    (Array.isArray(record.items) && record.items) ||
    (Array.isArray(record.files) && record.files) ||
    (Array.isArray(record.children) && record.children) ||
    []
  return list
    .map((entry) => toWorkspaceEntry(entry, workspaceRoot))
    .filter((entry): entry is GatewayWorkspaceEntry => Boolean(entry))
}

function extractFileContent(payload: unknown): string {
  if (typeof payload === "string") return payload
  const record = asRecord(payload)
  if (!record) return ""
  if (typeof record.content === "string") return record.content
  if (typeof record.text === "string") return record.text
  if (typeof record.data === "string") return record.data
  const file = asRecord(record.file)
  if (!file) return ""
  if (typeof file.content === "string") return file.content
  if (typeof file.text === "string") return file.text
  if (typeof file.data === "string") return file.data
  return ""
}

async function resolveAgentId(sessionKey: string): Promise<string> {
  const gateway = await connectToOpenClawGateway({
    scopes: ["operator.read"],
  })
  try {
    const response = await gateway.request<{ agentId?: string }>(
      "agent.identity.get",
      { sessionKey },
      30_000,
    )
    if (!response.ok || !response.payload?.agentId) {
      throw new Error(response.error?.message ?? "agent.identity.get failed")
    }
    return response.payload.agentId
  } finally {
    gateway.close()
  }
}

export async function listSessionWorkspaceFiles(input: {
  sessionKey: string
}): Promise<{ entries: GatewayWorkspaceEntry[] }> {
  const agentId = await resolveAgentId(input.sessionKey)
  const gateway = await connectToOpenClawGateway({
    scopes: ["operator.read"],
  })
  try {
    const response = await gateway.request(
      "agents.files.list",
      { agentId },
      30_000,
    )
    if (!response.ok) {
      throw new Error(response.error?.message ?? "agents.files.list failed")
    }
    return { entries: extractEntryList(response.payload) }
  } finally {
    gateway.close()
  }
}

export async function getSessionWorkspaceFile(input: {
  sessionKey: string
  path: string
}): Promise<{ content: string; encoding: "utf-8" }> {
  const agentId = await resolveAgentId(input.sessionKey)
  const gateway = await connectToOpenClawGateway({
    scopes: ["operator.read"],
  })
  try {
    const response = await gateway.request(
      "agents.files.get",
      {
        agentId,
        name: normalizeWorkspacePath(input.path),
      },
      30_000,
    )
    if (!response.ok) {
      throw new Error(response.error?.message ?? "agents.files.get failed")
    }
    return {
      content: extractFileContent(response.payload),
      encoding: "utf-8",
    }
  } finally {
    gateway.close()
  }
}

export async function writeSessionWorkspaceFile(input: {
  sessionKey: string
  path: string
  content: string
}): Promise<{ ok: true; path: string }> {
  const normalizedPath = normalizeWorkspacePath(input.path)
  const agentId = await resolveAgentId(input.sessionKey)
  const gateway = await connectToOpenClawGateway({
    scopes: ["operator.read", "operator.write", "operator.admin"],
  })
  try {
    const response = await gateway.request(
      "agents.files.set",
      {
        agentId,
        name: normalizedPath,
        content: input.content,
      },
      30_000,
    )
    if (!response.ok) {
      throw new Error(response.error?.message ?? "agents.files.set failed")
    }
    return {
      ok: true,
      path: normalizedPath,
    }
  } finally {
    gateway.close()
  }
}
