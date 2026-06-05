import { describe, expect, it } from "vitest"
import {
  deriveBootstrapChatState,
  type RawMessage,
} from "@/hooks/useChatMessages"
import type { ToolCallProjectionV2 } from "@/lib/chat-engine-v2/client"

describe("deriveBootstrapChatState", () => {
  it("works without top-level toolCalls and with a small global tools subset", () => {
    const childSessionKey = "agent:main:subagent:child-1"
    const rawMessages: RawMessage[] = [
      {
        role: "assistant",
        messageId: "assistant-old-tool",
        __openclaw: { seq: 1 },
        content: [
          {
            type: "tool_call",
            id: "old-tool",
            name: "exec",
            input: { command: "echo historical" },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "old-tool",
        toolName: "exec",
        text: "historical output",
        __openclaw: { seq: 2 },
      },
      {
        role: "assistant",
        messageId: "assistant-spawn",
        __openclaw: { seq: 3 },
        content: [
          {
            type: "tool_call",
            id: "spawn-1",
            name: "sessions_spawn",
            input: { label: "Researcher", task: "check docs" },
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "spawn-1",
        toolName: "sessions_spawn",
        text: `created ${childSessionKey}`,
        __openclaw: { seq: 4 },
      },
    ]
    const smallGlobalToolsSubset: ToolCallProjectionV2[] = [
      { toolCallId: "recent-running", name: "read", status: "running" },
      { toolCallId: "spawn-1", name: "sessions_spawn", status: "success" },
    ] as ToolCallProjectionV2[]

    const { canonicalMessages, inlineTools, canonicalSpawns } = deriveBootstrapChatState({
      sessionKey: "agent:main",
      rawMessages,
      canonicalTools: smallGlobalToolsSubset,
      runStatus: "running",
    })

    expect(inlineTools.map((tool) => tool.id)).toEqual(["recent-running", "spawn-1"])
    expect(canonicalSpawns).toHaveLength(1)
    expect(canonicalSpawns[0]).toMatchObject({
      toolCallId: "spawn-1",
      sessionKey: childSessionKey,
      status: "working",
    })

    const historicalTool = canonicalMessages
      .flatMap((message) => message.toolCalls ?? [])
      .find((tool) => tool.id === "old-tool")
    expect(historicalTool).toMatchObject({
      tool: "exec",
      status: "success",
      resultText: "historical output",
    })
  })
})
