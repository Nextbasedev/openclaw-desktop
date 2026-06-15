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
import type { SubagentLifecycleStatus } from "@/lib/subagentLifecycle"

const SPAWN_TOOL = "sessions_spawn"

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

function inferStatus(
  tool: InlineToolCall,
  childSessionKey: string | null,
): SubagentLifecycleStatus {
  // Tool-level status drives subagent lifecycle. The tool result text or input
  // surfaces the child session key once spawn succeeds.
  if (tool.status === "error") return "failed"
  if (tool.status === "success") {
    // If the sessions_spawn call settled successfully but we have no child link,
    // treat as completed (degenerate case — server never returned a session).
    return childSessionKey ? "completed" : "completed"
  }
  // running
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

export type SubagentAnchorMaps = {
  byTriggerUserId: Map<string, SpawnedSubagent[]>
  orphanByAssistantId: Map<string, SpawnedSubagent[]>
}

/**
 * Anchor subagents to their triggering user message when one exists, otherwise
 * to the assistant message that hosted the spawn (orphan). Mirrors the legacy
 * `subagentsByTriggerUserId` / `orphanSubagentsByAssistantId` rendering algo.
 */
export function buildSubagentAnchorMaps(
  messages: ChatMessage[],
  spawnsByToolCallId: Map<string, SpawnedSubagent>,
): SubagentAnchorMaps {
  const byTriggerUserId = new Map<string, SpawnedSubagent[]>()
  const orphanByAssistantId = new Map<string, SpawnedSubagent[]>()
  let nearestUserId: string | null = null
  for (const msg of messages) {
    if (msg.role === "user") {
      nearestUserId = msg.messageId
      continue
    }
    const matched: SpawnedSubagent[] = []
    for (const tool of msg.toolCalls ?? []) {
      if (tool.tool !== SPAWN_TOOL) continue
      const spawn = spawnsByToolCallId.get(tool.id)
      if (spawn) matched.push(spawn)
    }
    if (matched.length === 0) continue
    if (nearestUserId) {
      const existing = byTriggerUserId.get(nearestUserId) ?? []
      byTriggerUserId.set(
        nearestUserId,
        dedupeSpawnedSubagents([...existing, ...matched]),
      )
    } else {
      orphanByAssistantId.set(
        msg.messageId,
        dedupeSpawnedSubagents(matched),
      )
    }
  }
  return { byTriggerUserId, orphanByAssistantId }
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

// Exposed for the unused-but-historic terminal harvest helper.
export const __internal = {
  harvestTerminalSessionKeys,
}
