"use client"

import {
  extractSubagentSessionKey,
  isSubagentSessionKey,
} from "./subagentSession"

export type SubagentLifecycleStatus =
  | "spawning"
  | "linking"
  | "working"
  | "completed"
  | "failed"

export type SubagentLifecycleState = {
  id: string
  label: string
  task?: string
  childSessionKey: string | null
  status: SubagentLifecycleStatus
  toolCallId: string
  openEnabled: boolean
}

export type SubagentLifecycleInput = {
  id: string
  label: string
  task?: string
  sessionKey?: string | null
  status?: SubagentLifecycleStatus | "running" | "done" | "error"
  toolCallId: string
}

export type SubagentLifecycleEvent =
  | { type: "spawn_started"; toolCallId: string; label: string; task?: string }
  | { type: "spawn_linked"; toolCallId: string; payload: unknown }
  | { type: "spawn_done"; toolCallId: string; payload?: unknown; error?: unknown }
  | { type: "child_activity"; toolCallId: string }
  | { type: "child_yield"; toolCallId: string }
  | { type: "child_error"; toolCallId: string }
  | { type: "parent_done" }

export function normalizeSubagent(
  input: SubagentLifecycleInput,
): SubagentLifecycleState {
  const childSessionKey = isSubagentSessionKey(input.sessionKey)
    ? input.sessionKey
    : null
  const status = normalizeStatus(input.status, childSessionKey)
  return {
    id: input.id,
    label: input.label,
    task: input.task,
    childSessionKey,
    status,
    toolCallId: input.toolCallId,
    openEnabled: Boolean(childSessionKey),
  }
}

export function isActiveSubagent(status: SubagentLifecycleStatus) {
  return status === "spawning" || status === "linking" || status === "working"
}

export function subagentStatusLabel(
  status: SubagentLifecycleStatus,
): string {
  if (status === "spawning") return "spawning"
  if (status === "linking") return "linking"
  if (status === "working") return "working"
  if (status === "failed") return "failed"
  return "done"
}

export function reduceSubagentLifecycle(
  current: Map<string, SubagentLifecycleState>,
  event: SubagentLifecycleEvent,
): Map<string, SubagentLifecycleState> {
  const next = new Map(current)
  if (event.type === "parent_done") return next

  if (event.type === "spawn_started") {
    next.set(
      event.toolCallId,
      normalizeSubagent({
        id: `spawn:${event.toolCallId}`,
        label: event.label,
        task: event.task,
        status: "spawning",
        toolCallId: event.toolCallId,
      }),
    )
    return next
  }

  const existing = next.get(event.toolCallId)
  if (!existing) return next

  if (event.type === "spawn_linked") {
    const childSessionKey = extractSubagentSessionKey(event.payload)
    next.set(event.toolCallId, {
      ...existing,
      childSessionKey: childSessionKey ?? existing.childSessionKey,
      status: childSessionKey ?? existing.childSessionKey ? "working" : "linking",
      openEnabled: Boolean(childSessionKey ?? existing.childSessionKey),
    })
    return next
  }

  if (event.type === "spawn_done") {
    const childSessionKey =
      extractSubagentSessionKey(event.payload) ?? existing.childSessionKey
    next.set(event.toolCallId, {
      ...existing,
      childSessionKey,
      status: event.error ? "failed" : childSessionKey ? "working" : "linking",
      openEnabled: Boolean(childSessionKey),
    })
    return next
  }

  if (event.type === "child_activity") {
    next.set(event.toolCallId, {
      ...existing,
      status: existing.status === "completed" ? "completed" : "working",
    })
    return next
  }

  if (event.type === "child_yield") {
    next.set(event.toolCallId, {
      ...existing,
      status: "completed",
    })
    return next
  }

  next.set(event.toolCallId, {
    ...existing,
    status: "failed",
  })
  return next
}

function normalizeStatus(
  status: SubagentLifecycleInput["status"],
  childSessionKey: string | null,
): SubagentLifecycleStatus {
  if (status === "completed" || status === "done") {
    return childSessionKey ? "completed" : "linking"
  }
  if (status === "failed" || status === "error") return "failed"
  if (status === "spawning") return "spawning"
  if (status === "linking") return "linking"
  if (status === "working" || status === "running") {
    return childSessionKey ? "working" : "linking"
  }
  return childSessionKey ? "working" : "linking"
}
