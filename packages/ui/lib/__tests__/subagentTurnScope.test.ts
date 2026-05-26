import { describe, expect, it } from "vitest"
import { buildSubagentTurnScope, mergeCurrentTurnSubagents } from "../subagentTurnScope"
import type { ChatMessage, InlineToolCall, SpawnedSubagent } from "../../components/ChatView/types"

function user(messageId: string): ChatMessage {
  return { messageId, role: "user", text: messageId }
}

function assistant(messageId: string, toolCalls: InlineToolCall[] = []): ChatMessage {
  return { messageId, role: "assistant", text: "", toolCalls }
}

function spawnTool(id: string): InlineToolCall {
  return { id, tool: "sessions_spawn", status: "success" }
}

function sub(toolCallId: string, status: SpawnedSubagent["status"] = "completed"): SpawnedSubagent {
  return {
    id: `spawn:${toolCallId}`,
    label: toolCallId,
    sessionKey: `agent:${toolCallId}`,
    status,
    toolCallId,
  }
}

describe("subagent turn scope", () => {
  it("scopes current turn subagents to the latest user turn, not the whole session", () => {
    const scope = buildSubagentTurnScope(
      [
        user("u1"),
        assistant("a1", [spawnTool("old-1"), spawnTool("old-2")]),
        user("u2"),
        assistant("a2", [spawnTool("new-1")]),
      ],
      [sub("old-1"), sub("old-2"), sub("new-1")]
    )

    expect(scope.anchoredCount).toBe(3)
    expect(scope.currentTurnSubagents.map((item) => item.toolCallId)).toEqual(["new-1"])
  })

  it("keeps activity/session-global spawns separate from floating bar scope", () => {
    const spawnedSubagents = [sub("old-1"), sub("old-2"), sub("new-1")]
    const scope = buildSubagentTurnScope(
      [user("u1"), assistant("a1", [spawnTool("old-1"), spawnTool("old-2")]), user("u2")],
      spawnedSubagents
    )

    expect(spawnedSubagents).toHaveLength(3)
    expect(scope.currentTurnSubagents).toHaveLength(0)
  })

  it("adds live current-turn pending spawns without resurrecting old turn spawns", () => {
    const scope = buildSubagentTurnScope(
      [user("u1"), assistant("a1", [spawnTool("old-1")]), user("u2")],
      [sub("old-1"), sub("live-1", "working")]
    )

    const floating = mergeCurrentTurnSubagents(
      scope.currentTurnSubagents,
      [{ id: "live-1", tool: "sessions_spawn", status: "running" }],
      scope.spawnsByToolCallId
    )

    expect(floating.map((item) => item.toolCallId)).toEqual(["live-1"])
  })

  it("dedupes live and backfilled records for the same linked child session", () => {
    const live = { ...sub("live-tool", "working"), sessionKey: "agent:main:subagent:same-child" }
    const backfilled = { ...sub("history-tool", "completed"), sessionKey: "agent:main:subagent:same-child" }
    const scope = buildSubagentTurnScope(
      [user("u1"), assistant("a1", [spawnTool("live-tool"), spawnTool("history-tool")])],
      [live, backfilled]
    )

    expect(scope.currentTurnSubagents).toHaveLength(1)
    expect(scope.currentTurnSubagents[0].sessionKey).toBe("agent:main:subagent:same-child")
  })
})
