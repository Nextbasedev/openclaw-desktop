"use client"

import type { InlineToolCall, SpawnedSubagent, StreamStatus } from "../components/ChatView/types"
import { isActiveSubagent } from "./subagentLifecycle"

export type ChatActivitySnapshot = {
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  updatedAt: number
}

type ChatActivityListener = (sessionKey: string, snapshot: ChatActivitySnapshot | null) => void

const activity = new Map<string, ChatActivitySnapshot>()
const listeners = new Set<ChatActivityListener>()
const CHAT_ACTIVITY_STALE_MS = 10 * 60 * 1000

function emitActivity(sessionKey: string, snapshot: ChatActivitySnapshot | null) {
  for (const listener of [...listeners]) listener(sessionKey, snapshot)
}

function isFresh(snapshot: ChatActivitySnapshot, now = Date.now()) {
  return now - snapshot.updatedAt <= CHAT_ACTIVITY_STALE_MS
}

function pruneStaleActivity(now = Date.now()) {
  for (const [sessionKey, snapshot] of activity) {
    if (isFresh(snapshot, now)) continue
    activity.delete(sessionKey)
    emitActivity(sessionKey, null)
  }
}

function hasLiveTool(tools: InlineToolCall[]) {
  return tools.some((tool) => tool.status === "running")
}

function hasLiveSubagent(subagents: SpawnedSubagent[]) {
  return subagents.some((subagent) => isActiveSubagent(subagent.status))
}

export function isLiveChatStatus(status: StreamStatus) {
  return ["queued", "running", "collect", "thinking", "tool_running", "streaming", "stopping", "restarting"].includes(status)
}

export function cacheChatActivity(
  sessionKey: string,
  snapshot: Omit<ChatActivitySnapshot, "updatedAt">,
) {
  const live =
    isLiveChatStatus(snapshot.status) ||
    hasLiveTool(snapshot.pendingTools) ||
    hasLiveSubagent(snapshot.spawnedSubagents)
  if (!live) {
    activity.delete(sessionKey)
    emitActivity(sessionKey, null)
    return
  }
  const next = { ...snapshot, updatedAt: Date.now() }
  activity.set(sessionKey, next)
  emitActivity(sessionKey, next)
}

export function markOptimisticChatActivity(
  sessionKey: string,
  label: string | null = "Thinking",
) {
  cacheChatActivity(sessionKey, {
    status: "thinking",
    statusLabel: label,
    pendingTools: [],
    spawnedSubagents: [],
  })
}

export function getCachedChatActivity(sessionKey: string) {
  const snapshot = activity.get(sessionKey)
  if (!snapshot) return null
  if (isFresh(snapshot)) return snapshot
  activity.delete(sessionKey)
  emitActivity(sessionKey, null)
  return null
}

export function clearCachedChatActivity(sessionKey: string) {
  activity.delete(sessionKey)
  emitActivity(sessionKey, null)
}

export function getAllCachedChatActivity() {
  pruneStaleActivity()
  return new Map(activity)
}

export function subscribeChatActivity(listener: ChatActivityListener) {
  pruneStaleActivity()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearChatActivityStoreForTests() {
  activity.clear()
  for (const listener of [...listeners]) listener("", null)
}
