"use client"

import type { InlineToolCall, SpawnedSubagent, StreamStatus } from "../components/ChatView/types"
import { isActiveSubagent } from "./subagentLifecycle"

type ChatActivitySnapshot = {
  status: StreamStatus
  statusLabel: string | null
  pendingTools: InlineToolCall[]
  spawnedSubagents: SpawnedSubagent[]
  updatedAt: number
}

const activity = new Map<string, ChatActivitySnapshot>()

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
    return
  }
  activity.set(sessionKey, { ...snapshot, updatedAt: Date.now() })
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
}

export function clearChatActivityStoreForTests() {
  activity.clear()
}
