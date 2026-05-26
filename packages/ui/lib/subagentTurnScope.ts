import type { ChatMessage, InlineToolCall, SpawnedSubagent } from "@/components/ChatView/types"

function subagentDedupeKey(subagent: SpawnedSubagent) {
  // Backfilled history can replay the same linked child session under a
  // different sessions_spawn tool id than the live event. For the user-visible
  // turn scope, the child session is the durable identity; toolCallId is only
  // a fallback for not-yet-linked pending spawns.
  return subagent.sessionKey ? `session:${subagent.sessionKey}` : `tool:${subagent.toolCallId}`
}

function dedupeSubagents(subagents: SpawnedSubagent[]) {
  const byKey = new Map<string, SpawnedSubagent>()
  for (const sub of subagents) {
    const key = subagentDedupeKey(sub)
    const existing = byKey.get(key)
    byKey.set(key, existing ? { ...existing, ...sub, toolCallId: existing.toolCallId || sub.toolCallId } : sub)
  }
  return Array.from(byKey.values())
}

export function subagentsForToolCalls(
  toolCalls: InlineToolCall[] | undefined,
  spawnsByToolCallId: Map<string, SpawnedSubagent>
): SpawnedSubagent[] {
  if (!toolCalls) return []
  const matched: SpawnedSubagent[] = []
  for (const tc of toolCalls) {
    if (tc.tool !== "sessions_spawn") continue
    const sub = spawnsByToolCallId.get(tc.id)
    if (sub) matched.push(sub)
  }
  return matched
}

export function buildSubagentTurnScope(
  renderedMessages: ChatMessage[],
  spawnedSubagents: SpawnedSubagent[]
) {
  const spawnsByToolCallId = new Map<string, SpawnedSubagent>()
  for (const sub of spawnedSubagents) {
    spawnsByToolCallId.set(sub.toolCallId, sub)
  }

  const subagentsByTriggerUserId = new Map<string, SpawnedSubagent[]>()
  const orphanSubagentsByAssistantId = new Map<string, SpawnedSubagent[]>()
  let nearestUserId: string | null = null
  let latestUserMessageId: string | null = null

  for (const msg of renderedMessages) {
    if (msg.role === "user") {
      nearestUserId = msg.messageId
      latestUserMessageId = msg.messageId
      continue
    }

    const msgSubagents = subagentsForToolCalls(msg.toolCalls, spawnsByToolCallId)
    if (msgSubagents.length === 0) continue

    if (nearestUserId) {
      const existing = subagentsByTriggerUserId.get(nearestUserId) ?? []
      subagentsByTriggerUserId.set(nearestUserId, dedupeSubagents([...existing, ...msgSubagents]))
    } else {
      orphanSubagentsByAssistantId.set(msg.messageId, msgSubagents)
    }
  }

  const currentTurnSubagents = latestUserMessageId
    ? (subagentsByTriggerUserId.get(latestUserMessageId) ?? [])
    : []

  return {
    spawnsByToolCallId,
    subagentsByTriggerUserId,
    orphanSubagentsByAssistantId,
    latestUserMessageId,
    currentTurnSubagents,
    currentTurnCount: currentTurnSubagents.length,
    anchoredCount: Array.from(subagentsByTriggerUserId.values()).reduce((sum, items) => sum + items.length, 0),
    orphanCount: Array.from(orphanSubagentsByAssistantId.values()).reduce((sum, items) => sum + items.length, 0),
  }
}

export function mergeCurrentTurnSubagents(
  anchoredCurrentTurnSubagents: SpawnedSubagent[],
  liveCurrentTurnToolCalls: InlineToolCall[],
  spawnsByToolCallId: Map<string, SpawnedSubagent>
) {
  const liveSubagents = subagentsForToolCalls(liveCurrentTurnToolCalls, spawnsByToolCallId)
  return dedupeSubagents([...anchoredCurrentTurnSubagents, ...liveSubagents])
}
