"use client"

import { frontendLog } from "@/lib/clientLogs"
import { currentWorkspaceLayoutWindowId } from "@/lib/workspaceLayoutPersistence"

export type ChatApplyDecisionSource =
  | "bootstrap"
  | "messages"
  | "patch"
  | "send"
  | "reconcile"
  | "side-metadata"
  | "route"
  | "scroll"

export type ChatApplyDecision = {
  windowId?: string | null
  instanceId?: string | null
  viewGeneration?: number | null
  source: ChatApplyDecisionSource
  targetSessionKey?: string | null
  activeSessionKey?: string | null
  renderedSessionKey?: string | null
  cursor?: number | null
  requestId?: string | null
  requestGeneration?: number | null
  willApply: boolean
  reason: string
  extra?: Record<string, unknown>
}

export type ChatViewInvariant = {
  windowId?: string | null
  viewGeneration?: number | null
  sidebarSessionKey?: string | null
  activeSessionKey?: string | null
  renderedSessionKey?: string | null
  messageListSessionKey?: string | null
  messageCount?: number
  reason?: string
}

export type ChatBootstrapRecoveryDetail = {
  sessionKey?: string | null
  reason?: string | null
  cursor?: number | null
  projectionGeneration?: number | null
}

export function currentChatWindowId() {
  try {
    return currentWorkspaceLayoutWindowId()
  } catch {
    return null
  }
}

export function logChatApplyDecision(decision: ChatApplyDecision) {
  frontendLog(
    "chat",
    "chat.apply-decision",
    {
      windowId: decision.windowId ?? currentChatWindowId(),
      instanceId: decision.instanceId ?? null,
      viewGeneration: decision.viewGeneration ?? null,
      source: decision.source,
      targetSessionKey: decision.targetSessionKey ?? null,
      activeSessionKey: decision.activeSessionKey ?? null,
      renderedSessionKey: decision.renderedSessionKey ?? null,
      cursor: decision.cursor ?? null,
      requestId: decision.requestId ?? null,
      requestGeneration: decision.requestGeneration ?? null,
      willApply: decision.willApply,
      reason: decision.reason,
      ...(decision.extra ?? {}),
    },
    decision.willApply ? "debug" : "warn",
  )
}

export function logChatRequestStaleSkip(decision: Omit<ChatApplyDecision, "willApply">) {
  frontendLog(
    "chat",
    "chat.request.stale-skip",
    {
      windowId: decision.windowId ?? currentChatWindowId(),
      instanceId: decision.instanceId ?? null,
      viewGeneration: decision.viewGeneration ?? null,
      source: decision.source,
      targetSessionKey: decision.targetSessionKey ?? null,
      activeSessionKey: decision.activeSessionKey ?? null,
      renderedSessionKey: decision.renderedSessionKey ?? null,
      cursor: decision.cursor ?? null,
      requestId: decision.requestId ?? null,
      requestGeneration: decision.requestGeneration ?? null,
      reason: decision.reason,
      ...(decision.extra ?? {}),
    },
    "warn",
  )
}

export function logChatStreamRecoveryDecision(decision: Omit<ChatApplyDecision, "source"> & { reason: string }) {
  frontendLog(
    "stream",
    "chat.stream.recovery-decision",
    {
      windowId: decision.windowId ?? currentChatWindowId(),
      instanceId: decision.instanceId ?? null,
      viewGeneration: decision.viewGeneration ?? null,
      source: "patch",
      targetSessionKey: decision.targetSessionKey ?? null,
      activeSessionKey: decision.activeSessionKey ?? null,
      renderedSessionKey: decision.renderedSessionKey ?? null,
      cursor: decision.cursor ?? null,
      requestId: decision.requestId ?? null,
      requestGeneration: decision.requestGeneration ?? null,
      willApply: decision.willApply,
      reason: decision.reason,
      ...(decision.extra ?? {}),
    },
    decision.willApply ? "warn" : "debug",
  )
}

export function logChatViewInvariant(invariant: ChatViewInvariant) {
  const sidebarSessionKey = invariant.sidebarSessionKey ?? null
  const activeSessionKey = invariant.activeSessionKey ?? null
  const renderedSessionKey = invariant.renderedSessionKey ?? null
  const messageListSessionKey = invariant.messageListSessionKey ?? null
  const expected = activeSessionKey ?? sidebarSessionKey ?? renderedSessionKey
  const ok = Boolean(
    (!expected || !activeSessionKey || activeSessionKey === expected) &&
    (!expected || !renderedSessionKey || renderedSessionKey === expected) &&
    (!expected || !messageListSessionKey || messageListSessionKey === expected)
  )

  frontendLog(
    "chat",
    "chat-view.invariant",
    {
      windowId: invariant.windowId ?? currentChatWindowId(),
      viewGeneration: invariant.viewGeneration ?? null,
      sidebarSessionKey,
      activeSessionKey,
      renderedSessionKey,
      messageListSessionKey,
      messageCount: invariant.messageCount ?? null,
      ok,
      reason: invariant.reason ?? null,
    },
    ok ? "debug" : "error",
  )
}

export function recoveryDetailFromEvent(event: Event): ChatBootstrapRecoveryDetail | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail
  if (!detail || typeof detail !== "object") return null
  const record = detail as Record<string, unknown>
  return {
    sessionKey: typeof record.sessionKey === "string" ? record.sessionKey : null,
    reason: typeof record.reason === "string" ? record.reason : null,
    cursor: typeof record.cursor === "number" ? record.cursor : null,
    projectionGeneration: typeof record.projectionGeneration === "number" ? record.projectionGeneration : null,
  }
}
