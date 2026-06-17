/**
 * Long-conversation streaming integrity tests.
 *
 * Reproduces Krish's reported bug: after several turns of real chat with mixed
 * text + tool calls, rendering started breaking — duplicate messages, looping
 * the same message, duplicated tool-call stacks.
 *
 * The fix lives in two places:
 *   1. `packages/ui/components/ChatView/messageRowKey.ts` — stable React keys
 *      derived from `messageId` only (not `runId`, which is shared across
 *      multiple physical rows in the same run).
 *   2. `applyChatPatch` already drops strictly-older cursors and merges
 *      same-id rows through `dedupeChatMessages`. These tests lock those
 *      invariants in for the long-conversation case.
 */
import { describe, expect, test } from "vitest"
import { applyChatPatch } from "../applyPatches"
import { dedupeChatMessages } from "../../chatMessageDedupe"
import { messageListKeys } from "../../../components/ChatView/messageRowKey"
import { orderChatMessages } from "../../../components/ChatView/orderChatMessages"
import type { ChatMessage } from "../../../components/ChatView/types"
import type { PatchFrame } from "../types"

const SESSION_KEY = "s1"

let cursor = 0
function nextCursor() {
  cursor += 1
  return cursor
}

function userConfirmedPatch(opts: {
  messageId: string
  text: string
  seq: number
  runId: string
}): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor: nextCursor(),
      type: "chat.message.upsert",
      sessionKey: SESSION_KEY,
      payload: {
        semanticType: "chat.user.confirmed",
        messageSeq: opts.seq,
        messageId: opts.messageId,
        runId: opts.runId,
        message: {
          role: "user",
          text: opts.text,
          __openclaw: { id: opts.messageId, seq: opts.seq, runId: opts.runId },
        },
      },
      createdAtMs: Date.now(),
    },
  }
}

function toolCallPatch(opts: {
  runId: string
  toolCallId: string
  toolName: string
  status: "running" | "success"
  resultText?: string
}): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor: nextCursor(),
      type: "chat.tool.upsert",
      sessionKey: SESSION_KEY,
      payload: {
        semanticType: opts.status === "success" ? "chat.tool.result" : "chat.tool.started",
        runId: opts.runId,
        toolCallId: opts.toolCallId,
        toolCall: {
          toolCallId: opts.toolCallId,
          name: opts.toolName,
          status: opts.status,
          phase: opts.status === "success" ? "result" : "running",
          argsMeta: {},
          resultMeta: opts.resultText,
          runId: opts.runId,
          startedAtMs: Date.now(),
          finishedAtMs: opts.status === "success" ? Date.now() + 100 : null,
        },
      },
      createdAtMs: Date.now(),
    },
  }
}

function assistantDeltaPatch(opts: { runId: string; text: string }): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor: nextCursor(),
      type: "chat.message.upsert",
      sessionKey: SESSION_KEY,
      payload: {
        semanticType: "chat.assistant.delta",
        runId: opts.runId,
        messageId: `live:${opts.runId}:assistant`,
        message: {
          role: "assistant",
          text: opts.text,
          __openclaw: { id: `live:${opts.runId}:assistant`, runId: opts.runId },
        },
      },
      createdAtMs: Date.now(),
    },
  }
}

function assistantFinalPatch(opts: {
  runId: string
  seq: number
  messageId: string
  text: string
}): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor: nextCursor(),
      type: "chat.message.upsert",
      sessionKey: SESSION_KEY,
      payload: {
        semanticType: "chat.assistant.final",
        runId: opts.runId,
        runStatus: "done",
        messageSeq: opts.seq,
        messageId: opts.messageId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: opts.text }],
          __openclaw: { id: opts.messageId, seq: opts.seq, runId: opts.runId },
        },
      },
      createdAtMs: Date.now(),
    },
  }
}

function applyAndDedupe(
  state: { cursor: number; messages: ChatMessage[] },
  frame: PatchFrame,
) {
  const next = applyChatPatch(state, frame)
  return {
    cursor: next.cursor,
    messages: orderChatMessages(dedupeChatMessages(next.messages)),
  }
}

function runOneTurn(
  state: { cursor: number; messages: ChatMessage[] },
  turn: number,
) {
  const runId = `run-${turn}`
  const userSeq = turn * 3 + 1
  const assistantSeq = turn * 3 + 2

  // Confirmed user message.
  state = applyAndDedupe(
    state,
    userConfirmedPatch({
      messageId: `user-${turn}`,
      text: `question ${turn}`,
      seq: userSeq,
      runId,
    }),
  )

  // One running tool, then one finished.
  state = applyAndDedupe(
    state,
    toolCallPatch({
      runId,
      toolCallId: `tool-${turn}-a`,
      toolName: "read",
      status: "running",
    }),
  )
  state = applyAndDedupe(
    state,
    toolCallPatch({
      runId,
      toolCallId: `tool-${turn}-a`,
      toolName: "read",
      status: "success",
      resultText: `tool result ${turn}-a`,
    }),
  )

  // Streaming assistant deltas (3 chunks).
  state = applyAndDedupe(state, assistantDeltaPatch({ runId, text: `Answer ${turn} part 1` }))
  state = applyAndDedupe(state, assistantDeltaPatch({ runId, text: `Answer ${turn} part 1 part 2` }))
  state = applyAndDedupe(
    state,
    assistantDeltaPatch({ runId, text: `Answer ${turn} part 1 part 2 part 3` }),
  )

  // Canonical final assistant.
  state = applyAndDedupe(
    state,
    assistantFinalPatch({
      runId,
      seq: assistantSeq,
      messageId: `assistant-${turn}`,
      text: `Answer ${turn} part 1 part 2 part 3`,
    }),
  )

  return state
}

describe("long conversation streaming", () => {
  test("12 turns of mixed text + tool calls produce exactly one row per logical message and stable keys", () => {
    cursor = 0
    let state: { cursor: number; messages: ChatMessage[] } = { cursor: 0, messages: [] }
    for (let turn = 0; turn < 12; turn += 1) {
      state = runOneTurn(state, turn)
    }

    // Every turn contributes exactly two visible rows: one user, one
    // assistant. (The live tools row is folded into the assistant via
    // dedupe / mergeIncomingAssistantWithPriorTools.)
    expect(state.messages.length).toBe(24)
    const userCount = state.messages.filter((m) => m.role === "user").length
    const assistantCount = state.messages.filter((m) => m.role === "assistant").length
    expect(userCount).toBe(12)
    expect(assistantCount).toBe(12)

    // Each assistant has exactly its own one tool call attached.
    const assistantRows = state.messages.filter((m) => m.role === "assistant")
    for (const row of assistantRows) {
      expect(row.toolCalls?.length ?? 0).toBe(1)
    }

    // Keys must be unique — duplicate keys are exactly what produced the
    // "ghost row / duplicated tool stack" rendering reported by Krish.
    const keys = messageListKeys(state.messages)
    expect(keys.length).toBe(state.messages.length)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("out-of-order patches by cursor are dropped (strictly older) and do not duplicate rows", () => {
    cursor = 0
    let state: { cursor: number; messages: ChatMessage[] } = { cursor: 0, messages: [] }
    state = runOneTurn(state, 0)
    const cursorAfterTurn0 = state.cursor
    const messagesAfterTurn0 = state.messages

    // Replay an old delta patch with a cursor BEFORE current cursor.
    const stalePatch: PatchFrame = {
      type: "patch",
      patch: {
        cursor: cursorAfterTurn0 - 5, // strictly older
        type: "chat.message.upsert",
        sessionKey: SESSION_KEY,
        payload: {
          semanticType: "chat.assistant.delta",
          runId: "run-0",
          messageId: "live:run-0:assistant",
          message: {
            role: "assistant",
            text: "stale!",
            __openclaw: { id: "live:run-0:assistant", runId: "run-0" },
          },
        },
        createdAtMs: Date.now(),
      },
    }
    const after = applyChatPatch(state, stalePatch)
    // applyChatPatch's first guard drops cursor <= state.cursor — returns
    // the same state reference.
    expect(after).toBe(state)
    expect(after.messages).toBe(messagesAfterTurn0)
  })

  test("run terminal then a trailing live delta does not resurrect the live row", () => {
    cursor = 0
    let state: { cursor: number; messages: ChatMessage[] } = { cursor: 0, messages: [] }
    state = runOneTurn(state, 0)
    const messageCountAfterFinal = state.messages.length
    const assistantAfterFinal = state.messages.filter((m) => m.role === "assistant")
    expect(assistantAfterFinal).toHaveLength(1)
    expect(assistantAfterFinal[0].messageId).toBe("assistant-0")

    // A late delta arrives after the final patch — same runId. It should
    // merge into the canonical assistant via the live-id replace path,
    // not appear as a second assistant row.
    state = applyAndDedupe(
      state,
      assistantDeltaPatch({ runId: "run-0", text: "Answer 0 part 1 part 2 part 3 trailing" }),
    )
    const assistantAfterLateDelta = state.messages.filter((m) => m.role === "assistant")
    expect(assistantAfterLateDelta).toHaveLength(1)
    // Row count must not grow.
    expect(state.messages.length).toBeLessThanOrEqual(messageCountAfterFinal + 1)
    const keys = messageListKeys(state.messages)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("react key for an assistant message is stable across delta -> final transition", () => {
    cursor = 0
    let state: { cursor: number; messages: ChatMessage[] } = { cursor: 0, messages: [] }
    state = applyAndDedupe(
      state,
      userConfirmedPatch({ messageId: "u1", text: "hi", seq: 1, runId: "run-1" }),
    )
    state = applyAndDedupe(state, assistantDeltaPatch({ runId: "run-1", text: "Hello" }))
    const liveKey = messageListKeys(state.messages).find((k) => k.includes("live:run-1:assistant"))
    expect(liveKey).toBeTruthy()

    // After the canonical final lands, the messageId changes from the live
    // placeholder to the canonical gateway id. This is a controlled, single-
    // step swap (one logical row at a time), and React handles it as an
    // unmount + remount of that row. The KEY of every OTHER row (the user
    // row) must stay byte-identical.
    const userKeyBefore = messageListKeys(state.messages).find((k) => k === "u1")
    state = applyAndDedupe(
      state,
      assistantFinalPatch({
        runId: "run-1",
        seq: 2,
        messageId: "assistant-final-1",
        text: "Hello world",
      }),
    )
    const userKeyAfter = messageListKeys(state.messages).find((k) => k === "u1")
    expect(userKeyAfter).toBe(userKeyBefore)
    // And the live key is gone — there is now exactly one assistant row.
    const allKeys = messageListKeys(state.messages)
    expect(new Set(allKeys).size).toBe(allKeys.length)
    expect(state.messages.filter((m) => m.role === "assistant")).toHaveLength(1)
  })

  test("multiple assistant rows in one run never collide on the React key (regression)", () => {
    // Reproduces the dominant root cause directly: before the fix, multiple
    // distinct physical rows sharing a runId all returned the same React
    // key. This test would have failed before — `messageListKeys` would
    // have produced duplicate raw keys (collision), forcing the wrapper
    // to disambiguate with `#1` suffixes. The base messageRowKey must
    // already be unique per row; messageListKeys is just defense in depth.
    const messages: ChatMessage[] = [
      { messageId: "live:run-1:tools", role: "assistant", text: "", runId: "run-1", toolCalls: [{ id: "t1", tool: "read", status: "running" }] },
      { messageId: "live:run-1:assistant", role: "assistant", text: "Hello", runId: "run-1" },
      { messageId: "assistant-final-1", role: "assistant", text: "Hello world", runId: "run-1", gatewayIndex: 3 },
    ]
    const keys = messageListKeys(messages)
    // No `#1` disambiguation suffix should be needed — base keys are unique.
    for (const key of keys) {
      expect(key.includes("#")).toBe(false)
    }
    expect(new Set(keys).size).toBe(3)
  })
})
