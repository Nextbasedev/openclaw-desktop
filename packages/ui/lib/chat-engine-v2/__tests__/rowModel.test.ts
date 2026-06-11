import { describe, expect, it } from "vitest"
import type { ChatMessage } from "@/components/ChatView/types"
import { buildChatTimelineRows, chatTimelineRowId, toChatTimelineRow } from "../rowModel"

function msg(id: string, text: string, seq?: number, role: "user" | "assistant" = "assistant"): ChatMessage {
  return {
    messageId: id,
    role,
    text,
    gatewayIndex: seq,
  } as ChatMessage
}

describe("chat row model", () => {
  it("uses durable sequence as the primary row identity", () => {
    expect(chatTimelineRowId(msg("gateway-a", "hello", 42))).toBe("seq:42")
  })

  it("keeps row id stable when a live row gains more text", () => {
    const first = toChatTimelineRow(msg("assistant-1", "hello", 2))
    const next = toChatTimelineRow(msg("assistant-1", "hello world", 2), first)

    expect(next.rowId).toBe(first.rowId)
    expect(next.mutationVersion).not.toBe(first.mutationVersion)
    expect(next.heightVersion).not.toBe(first.heightVersion)
  })

  it("preserves measured height and heavy state when height-driving content is unchanged", () => {
    const first = {
      ...toChatTimelineRow(msg("assistant-1", "hello", 2)),
      heightEstimate: 321,
      heavyState: "collapsed" as const,
    }
    const next = toChatTimelineRow({ ...msg("assistant-1", "hello", 2), model: "gpt" }, first)

    expect(next.heightEstimate).toBe(321)
    expect(next.heavyState).toBe("collapsed")
  })

  it("builds rows in message order and reuses existing row state by row id", () => {
    const existing = [{
      ...toChatTimelineRow(msg("m2", "two", 2)),
      heightEstimate: 444,
      heavyState: "unloaded" as const,
    }]
    const rows = buildChatTimelineRows([msg("m1", "one", 1), msg("m2", "two", 2)], existing)

    expect(rows.map((row) => row.rowId)).toEqual(["seq:1", "seq:2"])
    expect(rows[1]).toMatchObject({ heightEstimate: 444, heavyState: "unloaded" })
  })
})
