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

function emitActivity(sessionKey: string, snapshot: ChatActivitySnapshot | null) {
  for (const listener of [...listeners]) listener(sessionKey, snapshot)
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
  return activity.get(sessionKey) ?? null
}

export function clearCachedChatActivity(sessionKey: string) {
  activity.delete(sessionKey)
  emitActivity(sessionKey, null)
}

export function getAllCachedChatActivity() {
  return new Map(activity)
}

export function subscribeChatActivity(listener: ChatActivityListener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function clearChatActivityStoreForTests() {
  activity.clear()
  for (const listener of [...listeners]) listener("", null)
}
