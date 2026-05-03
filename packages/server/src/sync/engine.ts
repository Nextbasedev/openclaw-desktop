import { upsertGatewaySession, deleteChatSession } from "middleware"
import { getDb } from "../db/connection.js"
import { getAppSetting, nowIso, sqlToBool } from "../db/helpers.js"
import { isGatewayConnected, gatewayEvents } from "../gateway/client.js"
import {
  anchorKey,
  encodeAnchorLabel,
  encodeSessionLabel,
  type SyncPayload,
} from "./encoding.js"
import { forgetAnchor, getAnchorSessionKey, rememberAnchor } from "./anchor.js"
import { claimDueTasks, markDone, markFailed, type OutboxRow } from "./outbox.js"
import { pullOnce } from "./pull.js"
import { runBackfillIfNeeded } from "./backfill.js"

const TICK_MS = 2_000
const PULL_INTERVAL_MS = 30_000
let tickTimer: ReturnType<typeof setTimeout> | null = null
let pullTimer: ReturnType<typeof setTimeout> | null = null
let running = false
let pulling = false
let enabled = false

function deviceId(): string {
  return getAppSetting(getDb(), "sync.device_id") ?? ""
}

function buildProjectPayload(entityId: string): SyncPayload | null {
  const db = getDb()
  const row = db
    .prepare(
      "SELECT id, name, archived, pinned, sort_order, updated_at, deleted_at FROM projects WHERE id = ?",
    )
    .get(entityId) as
    | {
        id: string
        name: string
        archived: number
        pinned: number
        sort_order: string | null
        updated_at: string
        deleted_at: string | null
      }
    | undefined
  if (!row) return null
  return {
    schema: 1,
    kind: "project",
    ids: { projectId: row.id },
    names: { projectName: row.name },
    project: {
      archived: sqlToBool(row.archived),
      pinned: sqlToBool(row.pinned),
      sortOrderKey: row.sort_order ?? undefined,
    },
    updatedAt: row.updated_at,
    updatedBy: deviceId(),
    deletedAt: row.deleted_at ?? undefined,
  }
}

function buildTopicPayload(entityId: string): SyncPayload | null {
  const db = getDb()
  const row = db
    .prepare(
      "SELECT id, project_id, name, archived, sort_order_key, updated_at, deleted_at FROM topics WHERE id = ?",
    )
    .get(entityId) as
    | {
        id: string
        project_id: string
        name: string
        archived: number
        sort_order_key: string | null
        updated_at: string
        deleted_at: string | null
      }
    | undefined
  if (!row) return null
  return {
    schema: 1,
    kind: "topic",
    ids: { projectId: row.project_id, topicId: row.id },
    names: { topicName: row.name },
    topic: {
      archived: sqlToBool(row.archived),
      sortOrderKey: row.sort_order_key ?? undefined,
    },
    updatedAt: row.updated_at,
    updatedBy: deviceId(),
    deletedAt: row.deleted_at ?? undefined,
  }
}

function buildChatPayload(entityId: string): {
  payload: SyncPayload
  sessionKey: string | null
  userName: string
} | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT c.id, c.name, c.session_key, c.agent_id, c.archived, c.pinned,
              c.last_active_at, c.updated_at, c.deleted_at,
              sm.project_id, sm.topic_id, sm.sort_order_key,
              sm.label AS gateway_label
       FROM chats c
       LEFT JOIN session_mappings sm ON sm.session_key = c.session_key
       WHERE c.id = ?`,
    )
    .get(entityId) as
    | {
        id: string
        name: string
        session_key: string | null
        agent_id: string
        archived: number
        pinned: number
        last_active_at: string | null
        updated_at: string
        deleted_at: string | null
        project_id: string | null
        topic_id: string | null
        sort_order_key: string | null
        gateway_label: string | null
      }
    | undefined
  if (!row) return null
  if (!row.project_id) return null
  const gatewayName = row.gateway_label ?? row.name
  const payload: SyncPayload = {
    schema: 1,
    kind: "chat",
    ids: {
      projectId: row.project_id,
      topicId: row.topic_id ?? undefined,
      chatId: row.id,
    },
    names: { chatName: gatewayName },
    chat: {
      archived: sqlToBool(row.archived),
      pinned: sqlToBool(row.pinned),
      agentId: row.agent_id,
      sortOrderKey: row.sort_order_key ?? undefined,
      lastActiveAt: row.last_active_at ?? undefined,
    },
    updatedAt: row.updated_at,
    updatedBy: deviceId(),
    deletedAt: row.deleted_at ?? undefined,
  }
  return { payload, sessionKey: row.session_key, userName: gatewayName }
}

function clearDirty(task: OutboxRow, pushedAt?: string, sessionKey?: string | null): void {
  const db = getDb()
  const updatedAtGuard = pushedAt ? " AND updated_at <= ?" : ""
  const params = pushedAt ? [pushedAt, task.entity_id] : [task.entity_id]

  if (task.entity_type === "project") {
    db.prepare(`UPDATE projects SET sync_dirty = 0 WHERE id = ?${updatedAtGuard}`)
      .run(...(pushedAt ? [task.entity_id, pushedAt] : params))
    return
  }

  if (task.entity_type === "topic") {
    db.prepare(`UPDATE topics SET sync_dirty = 0 WHERE id = ?${updatedAtGuard}`)
      .run(...(pushedAt ? [task.entity_id, pushedAt] : params))
    return
  }

  if (task.entity_type === "chat") {
    db.prepare(`UPDATE chats SET sync_dirty = 0 WHERE id = ?${updatedAtGuard}`)
      .run(...(pushedAt ? [task.entity_id, pushedAt] : params))
    if (sessionKey) {
      db.prepare(
        `UPDATE session_mappings SET sync_dirty = 0 WHERE session_key = ?${pushedAt ? " AND updated_at <= ?" : ""}`,
      ).run(...(pushedAt ? [sessionKey, pushedAt] : [sessionKey]))
    }
  }
}

async function pushOne(task: OutboxRow): Promise<void> {
  if (task.op === "delete") {
    if (task.entity_type === "chat") {
      const sessionKey = getAnchorSessionKey("chat", task.entity_id)
      if (sessionKey) {
        try {
          await deleteChatSession(sessionKey)
        } catch {
          // ignore; session may already be gone
        }
        forgetAnchor("chat", task.entity_id)
      }
      return
    }
    const existing = getAnchorSessionKey(task.entity_type, task.entity_id)
    if (existing) {
      try {
        await deleteChatSession(existing)
      } catch {
        // ignore
      }
      forgetAnchor(task.entity_type, task.entity_id)
    }
    return
  }

  if (task.entity_type === "project") {
    const payload = buildProjectPayload(task.entity_id)
    if (!payload) return
    const preferredKey =
      getAnchorSessionKey("project", task.entity_id) ?? anchorKey("project", task.entity_id)
    const result = await upsertGatewaySession({
      key: preferredKey,
      label: encodeAnchorLabel(payload),
    })
    rememberAnchor("project", task.entity_id, result.sessionKey)
    clearDirty(task, payload.updatedAt)
    return
  }

  if (task.entity_type === "topic") {
    const payload = buildTopicPayload(task.entity_id)
    if (!payload) return
    const preferredKey =
      getAnchorSessionKey("topic", task.entity_id) ?? anchorKey("topic", task.entity_id)
    const result = await upsertGatewaySession({
      key: preferredKey,
      label: encodeAnchorLabel(payload),
    })
    rememberAnchor("topic", task.entity_id, result.sessionKey)
    clearDirty(task, payload.updatedAt)
    return
  }

  if (task.entity_type === "chat") {
    const built = buildChatPayload(task.entity_id)
    if (!built || !built.sessionKey) return
    await upsertGatewaySession({
      key: built.sessionKey,
      label: encodeSessionLabel(built.userName, built.payload),
    })
    rememberAnchor("chat", task.entity_id, built.sessionKey)
    clearDirty(task, built.payload.updatedAt, built.sessionKey)
    return
  }
}

export async function pushDueTasks(limit = 25): Promise<{ pushed: number; failed: number }> {
  if (!isGatewayConnected()) return { pushed: 0, failed: 0 }
  const tasks = claimDueTasks(limit)
  let pushed = 0
  let failed = 0
  for (const task of tasks) {
    try {
      await pushOne(task)
      markDone(task.id)
      pushed += 1
    } catch (err) {
      markFailed(task.id, err instanceof Error ? err.message : String(err))
      failed += 1
    }
  }
  return { pushed, failed }
}

async function tick(): Promise<void> {
  if (running) return
  if (!enabled) return
  if (!isGatewayConnected()) return
  running = true
  try {
    await pushDueTasks(25)
  } finally {
    running = false
    scheduleNext()
  }
}

function scheduleNext(): void {
  if (tickTimer) clearTimeout(tickTimer)
  tickTimer = setTimeout(() => {
    void tick()
  }, TICK_MS)
}

async function pullTick(): Promise<void> {
  if (pulling) return
  if (!enabled) return
  if (!isGatewayConnected()) return
  pulling = true
  try {
    await pullOnce()
  } catch {
    // ignore; next tick will retry
  } finally {
    pulling = false
    schedulePull()
  }
}

function schedulePull(): void {
  if (pullTimer) clearTimeout(pullTimer)
  pullTimer = setTimeout(() => {
    void pullTick()
  }, PULL_INTERVAL_MS)
}

export function startSyncEngine(): void {
  if (enabled) return
  enabled = true
  try {
    runBackfillIfNeeded()
  } catch {
    // non-fatal
  }
  gatewayEvents.on("connected", () => {
    void tick()
    void pullTick()
  })
  scheduleNext()
  schedulePull()
}

export function stopSyncEngine(): void {
  enabled = false
  if (tickTimer) {
    clearTimeout(tickTimer)
    tickTimer = null
  }
  if (pullTimer) {
    clearTimeout(pullTimer)
    pullTimer = null
  }
}

export function kickSyncEngine(): void {
  if (!enabled) return
  void tick()
}

export { nowIso }
