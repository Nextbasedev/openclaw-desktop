import { describe, expect, it } from "vitest"
import { buildTree, finalizeStaleRunningActivity, parseHistoryToolCalls } from "./activity-types"

describe("activity stale running reconciliation", () => {
  it("normalizes history timestamps and suppresses impossible activity durations", () => {
    const parsed = parseHistoryToolCalls([
      {
        role: "assistant",
        timestamp: 1_778_674_262,
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "session_status",
            args: {},
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tool-1",
        toolName: "session_status",
        timestamp: 1_778_674_268,
        content: [{ type: "text", text: "ok" }],
      },
    ])

    expect(parsed.calls[0].startedAt).toBe(1_778_674_262_000)
    expect(parsed.calls[0].duration).toBe("6.0s")

    const stale = parseHistoryToolCalls([
      {
        role: "assistant",
        timestamp: 1_778_600_000_000,
        content: [
          {
            type: "toolCall",
            id: "tool-2",
            name: "session_status",
            args: {},
            duration: "66662s",
          },
        ],
      },
      {
        role: "toolResult",
        toolCallId: "tool-2",
        toolName: "session_status",
        timestamp: 1_778_666_662_000,
        content: [{ type: "text", text: "ok" }],
      },
    ])

    expect(stale.calls[0].duration).toBeUndefined()
  })

  it("marks unresolved historical tool calls as success when backend session is idle", () => {
    const parsed = parseHistoryToolCalls([
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tool-1",
            name: "read",
            args: { path: "README.md" },
          },
        ],
      },
      {
        role: "assistant",
        text: "Done — the result is complete.",
      },
    ])

    expect(parsed.calls).toHaveLength(1)
    expect(parsed.calls[0].status).toBe("running")

    const reconciled = finalizeStaleRunningActivity(parsed.calls, parsed.agents)

    expect(reconciled.calls[0].status).toBe("success")
    expect(buildTree(reconciled.calls, "done", reconciled.agents)[0].status).toBe("success")
  })

  it("marks stale spawned agents done when no running backend session remains", () => {
    const parsed = parseHistoryToolCalls([
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "spawn-1",
            name: "sessions_spawn",
            args: { label: "worker" },
          },
        ],
      },
      {
        role: "assistant",
        text: "Worker finished and returned the final answer.",
      },
    ])

    const reconciled = finalizeStaleRunningActivity(parsed.calls, parsed.agents)
    const nodes = buildTree(reconciled.calls, "done", reconciled.agents)

    expect(nodes[0].status).toBe("success")
    expect(nodes[0].children?.[0]?.status).toBe("success")
  })
})
