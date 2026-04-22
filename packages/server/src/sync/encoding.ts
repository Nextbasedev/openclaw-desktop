const SENTINEL = "\x00JRV1\x00"

export type SyncKind = "project" | "topic" | "chat"

export type SyncPayload = {
  schema: 1
  kind: SyncKind
  ids: { projectId: string; topicId?: string; chatId?: string }
  names: { projectName?: string; topicName?: string; chatName?: string }
  project?: { archived?: boolean; sortOrderKey?: string; pinned?: boolean }
  topic?: { archived?: boolean; sortOrderKey?: string }
  chat?: {
    archived?: boolean
    pinned?: boolean
    sortOrderKey?: string
    agentId?: string
    lastActiveAt?: string
  }
  updatedAt: string
  updatedBy: string
  deletedAt?: string
}

export function encodeSessionLabel(userVisibleName: string, payload: SyncPayload): string {
  return `${userVisibleName}${SENTINEL}${JSON.stringify(payload)}`
}

export function encodeAnchorLabel(payload: SyncPayload): string {
  return `${SENTINEL}${JSON.stringify(payload)}`
}

export function decodeLabel(label: string | null | undefined): {
  userName: string
  payload: SyncPayload | null
} {
  if (!label) return { userName: "", payload: null }
  const idx = label.indexOf(SENTINEL)
  if (idx === -1) return { userName: label, payload: null }
  const userName = label.slice(0, idx)
  const json = label.slice(idx + SENTINEL.length)
  try {
    const parsed = JSON.parse(json) as SyncPayload
    if (parsed?.schema !== 1) return { userName, payload: null }
    return { userName, payload: parsed }
  } catch {
    return { userName, payload: null }
  }
}

export function anchorKey(kind: SyncKind, id: string): string {
  return `jarvis-anchor:${kind}:${id}`
}

export function isAnchorKey(key: string): { kind: SyncKind; id: string } | null {
  const match = key.match(/^jarvis-anchor:(project|topic|chat):(.+)$/)
  if (!match) return null
  return { kind: match[1] as SyncKind, id: match[2] }
}
