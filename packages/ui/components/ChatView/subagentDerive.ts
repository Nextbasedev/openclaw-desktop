/**
 * Derive SpawnedSubagent[] from rendered ChatMessages.
 *
 * The rebuilt ChatView does NOT use the chat-engine-v2 global store. The
 * legacy implementation pulled `spawnedSubagents` from a session slice; this
 * module re-derives the equivalent state directly from the windowed message
 * array so subagent rendering works without store integration.
 *
 * Live updates flow naturally: as `chat.tool.*` patches mutate the
 * `tool.status` / `tool.resultText` on the underlying message via
 * `applyChatPatch`, this derivation recomputes on each render.
 */

import type { ChatMessage, InlineToolCall, SpawnedSubagent } from "./types"
import { dedupeSpawnedSubagents } from "@/lib/chat-engine-v2/store"
import {
  extractSubagentSessionKey,
  extractSubagentSessionKeys,
} from "@/lib/subagentSession"
import { isActiveSubagent, type SubagentLifecycleStatus } from "@/lib/subagentLifecycle"

const SPAWN_TOOL = "sessions_spawn"

function subagentStatusRank(status: SubagentLifecycleStatus) {
  if (status === "failed") return 5
  if (status === "completed") return 4
  if (status === "working") return 3
  if (status === "linking") return 2
  return 1
}

function compact(label: unknown, fallback: string): string {
  if (typeof label !== "string") return fallback
  const trimmed = label.trim()
  return trimmed.length ? trimmed : fallback
}

function recordInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {}
}

function resultTextLooksSuccessful(resultText: string | null | undefined): boolean {
  if (!resultText) return false
  const lower = resultText.toLowerCase()
  return (
    lower.includes("completed successfully") ||
    lower.includes("\"status\": \"completed\"") ||
    lower.includes("status: completed") ||
    lower.includes("task completed") ||
    lower.includes("\"success\": true")
  )
}

function resultTextLooksFailed(resultText: string | null | undefined): boolean {
  if (!resultText) return false
  const lower = resultText.toLowerCase()
  // Only treat as failed if explicit failure markers appear. Don't conflate
  // with 'error' substrings that appear in successful output (e.g. a
  // sub-agent saying 'fixed 3 errors').
  return (
    lower.includes("\"status\": \"failed\"") ||
    lower.includes("status: failed") ||
    lower.includes("\"status\": \"error\"") ||
    lower.includes("task aborted") ||
    lower.includes("task failed") ||
    lower.includes("\"success\": false")
  )
}

function inferStatus(
  tool: InlineToolCall,
  childSessionKey: string | null,
): SubagentLifecycleStatus {
  // Three-signal status derivation:
  //   1. Tool's own status (running / success / error) from middleware.
  //   2. Result text patterns (more reliable than raw tool.status for
  //      sessions_spawn because the gateway can flag the tool as error/success
  //      for non-fatal reasons — e.g. transient timeout while child is still
  //      producing output).
  //   3. Presence of child session key (means spawn succeeded, child exists).
  //
  // Result text takes PRIORITY when it explicitly indicates completion or
  // failure. If result text says "completed successfully" but tool.status is
  // "error" (because middleware misread a sub-agent log), we still mark the
  // sub-agent as completed — because the user-visible truth is that the
  // sub-agent finished its work.
  if (resultTextLooksFailed(tool.resultText)) return "failed"
  if (resultTextLooksSuccessful(tool.resultText)) return "completed"

  // No definitive result text signal yet — fall back to tool status.
  if (tool.status === "error") {
    // Tool errored but no failure marker in result text. If the child session
    // exists and there's no positive failure signal, treat as completed
    // (sub-agent at least produced something) rather than aggressively
    // flipping to failed.
    return childSessionKey ? "completed" : "failed"
  }
  if (tool.status === "success") {
    // sessions_spawn success usually means the child session was created, not
    // that the child finished. Keep linked children live until an explicit
    // terminal marker arrives from the result text/lifecycle stream.
    return childSessionKey ? "working" : "completed"
  }

  // Still running (tool.status === 'running'): if we have a child session,
  // sub-agent is actively working. Otherwise it's still spawning.
  return childSessionKey ? "working" : "spawning"
}

function spawnFromTool(
  tool: InlineToolCall,
  index: number,
): SpawnedSubagent | null {
  if (tool.tool !== SPAWN_TOOL) return null
  const args = recordInput(tool.input)
  const task = typeof args.task === "string" ? args.task : ""
  const labelFallback = task
    ? `${task.slice(0, 60)}${task.length > 60 ? "…" : ""}`
    : `Sub-agent ${index + 1}`
  const sessionKey =
    extractSubagentSessionKey(tool.input) ??
    extractSubagentSessionKey(tool.resultText) ??
    null
  return {
    id: `spawn:${tool.id}`,
    label: compact(args.label ?? args.agentId, labelFallback),
    task: task || undefined,
    sessionKey,
    status: inferStatus(tool, sessionKey),
    toolCallId: tool.id,
  }
}

/**
 * Walk through tool result-text content for terminal markers that may have
 * arrived as standalone tool-result messages without populating
 * `tool.resultText` directly. This catches edge cases where the
 * child-session key only appears in a sibling tool-result text.
 */
function harvestTerminalSessionKeys(messages: ChatMessage[]): Set<string> {
  const keys = new Set<string>()
  for (const message of messages) {
    for (const tool of message.toolCalls ?? []) {
      if (!tool.resultText) continue
      for (const key of extractSubagentSessionKeys(tool.resultText)) {
        keys.add(key)
      }
    }
  }
  return keys
}

export function deriveSpawnedSubagents(messages: ChatMessage[]): SpawnedSubagent[] {
  const spawns: SpawnedSubagent[] = []
  let spawnIndex = 0
  for (const message of messages) {
    for (const tool of message.toolCalls ?? []) {
      const spawn = spawnFromTool(tool, spawnIndex)
      if (spawn) {
        spawns.push(spawn)
        spawnIndex += 1
      }
    }
  }
  // Use the store's dedupe helper so we share the exact same identity rules.
  return dedupeSpawnedSubagents(spawns)
}

export function applySubagentStatusOverrides(
  spawns: SpawnedSubagent[],
  statusBySessionKey: Map<string, SubagentLifecycleStatus>,
): SpawnedSubagent[] {
  if (statusBySessionKey.size === 0 || spawns.length === 0) return spawns
  return dedupeSpawnedSubagents(
    spawns.map((spawn) => {
      if (!spawn.sessionKey) return spawn
      const status = statusBySessionKey.get(spawn.sessionKey)
      return status && status !== spawn.status ? { ...spawn, status } : spawn
    }),
  )
}

export function mergeAuthoritativeSubagents(
  derivedSpawns: SpawnedSubagent[],
  authoritativeSpawns: SpawnedSubagent[],
): SpawnedSubagent[] {
  if (authoritativeSpawns.length === 0) return derivedSpawns

  const byToolCallId = new Map(
    authoritativeSpawns.map((spawn) => [spawn.toolCallId, spawn]),
  )
  const bySessionKey = new Map(
    authoritativeSpawns
      .filter((spawn) => spawn.sessionKey)
      .map((spawn) => [spawn.sessionKey as string, spawn]),
  )

  return dedupeSpawnedSubagents([
    ...derivedSpawns.map((spawn) => {
      const authoritative =
        bySessionKey.get(spawn.sessionKey ?? "") ??
        byToolCallId.get(spawn.toolCallId)
      if (!authoritative) return spawn
      return {
        ...spawn,
        label: spawn.label || authoritative.label,
        task: spawn.task || authoritative.task,
        sessionKey: spawn.sessionKey || authoritative.sessionKey,
        status:
          subagentStatusRank(authoritative.status) >= subagentStatusRank(spawn.status)
            ? authoritative.status
            : spawn.status,
      }
    }),
    ...authoritativeSpawns,
  ])
}

export type SubagentAnchorMaps = {
  orphanByAssistantId: Map<string, SpawnedSubagent[]>
}

/**
 * Anchor subagents to the assistant message that hosted the spawn.
 * Previously subagents were anchored to the triggering user message, but now
 * they render inline with the response components.
 */
export function buildSubagentAnchorMaps(
  messages: ChatMessage[],
  spawnsByToolCallId: Map<string, SpawnedSubagent>,
): SubagentAnchorMaps {
  const orphanByAssistantId = new Map<string, SpawnedSubagent[]>()
  for (const msg of messages) {
    if (msg.role !== "assistant") continue
    const matched: SpawnedSubagent[] = []
    for (const tool of msg.toolCalls ?? []) {
      if (tool.tool !== SPAWN_TOOL) continue
      const spawn = spawnsByToolCallId.get(tool.id)
      if (spawn) matched.push(spawn)
    }
    if (matched.length === 0) continue
    const existing = orphanByAssistantId.get(msg.messageId) ?? []
    orphanByAssistantId.set(
      msg.messageId,
      dedupeSpawnedSubagents([...existing, ...matched]),
    )
  }
  return { orphanByAssistantId }
}

export function indexSpawnsByToolCallId(
  spawns: SpawnedSubagent[],
): Map<string, SpawnedSubagent> {
  const map = new Map<string, SpawnedSubagent>()
  for (const spawn of spawns) {
    map.set(spawn.toolCallId, spawn)
  }
  return map
}

export function abortSessionKeysForActiveRun(
  parentSessionKey: string,
  spawns: SpawnedSubagent[],
): string[] {
  const keys = new Set<string>([parentSessionKey])
  for (const spawn of spawns) {
    if (!spawn.sessionKey) continue
    if (!isActiveSubagent(spawn.status)) continue
    if (spawn.sessionKey === parentSessionKey) continue
    keys.add(spawn.sessionKey)
  }
  return Array.from(keys)
}

// Exposed for the unused-but-historic terminal harvest helper.
export const __internal = {
  harvestTerminalSessionKeys,
}
