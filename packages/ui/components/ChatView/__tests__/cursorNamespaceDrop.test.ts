/**
 * BUG-1 regression test (docs/audit/frontend-window-audit-2026-06-17.md).
 *
 * The SSE patch handler used to pass `frame.patch.cursor` — the GLOBAL
 * cross-session projection event ordinal — as `patchSessionCursor` to
 * `shouldDropPatchAsEvicted`, which then compared it against the per-session
 * `newestLoadedSeq` (ChatMessage.gatewayIndex). Two different number spaces.
 * Once a user scrolled up (hasNewer=true), every live patch was silently
 * dropped because the global cursor always dwarfs any per-session seq.
 *
 * The fix introduces `derivePatchTargetSeq(frame, messages)` which returns the
 * per-session seq of the row a patch is targeting (from payload.messageSeq,
 * payload.gatewayIndex, an existing in-window row, or the parent user message
 * for tool patches). `shouldDropPatchAsEvicted` now takes `patchTargetSeq` and
 * treats `undefined` as "do not drop".
 */

import { describe, expect, test } from "vitest"
import type { ChatMessage } from "../types"
import type { PatchFrame } from "../../../lib/chat-engine-v2/types"
import { derivePatchTargetSeq } from "../../../lib/chat-engine-v2/applyPatches"
import { shouldDropPatchAsEvicted } from "../messageWindow"

function makeMessage(overrides: Partial<ChatMessage> & Pick<ChatMessage, "messageId" | "role" | "text" | "createdAt">): ChatMessage {
  return {
    ...overrides,
  } as ChatMessage
}

function makeMessageUpsertFrame(input: {
  cursor: number
  sessionKey?: string
  messageId: string
  role?: "user" | "assistant"
  text?: string
  messageSeq?: number
  runId?: string
}): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor: input.cursor,
      type: "chat.message.upsert",
      sessionKey: input.sessionKey ?? "s1",
      payload: {
        semanticType: "chat.message.upsert",
        messageId: input.messageId,
        messageSeq: input.messageSeq,
        runId: input.runId,
        message: {
          id: input.messageId,
          role: input.role ?? "assistant",
          text: input.text ?? "",
          ...(typeof input.messageSeq === "number"
            ? { __openclaw: { seq: input.messageSeq, ...(input.runId ? { runId: input.runId } : {}) } }
            : {}),
        },
      },
      createdAtMs: 1,
    },
  } as PatchFrame
}

function makeToolPatchFrame(input: {
  cursor: number
  sessionKey?: string
  runId: string
  toolId: string
  status?: "running" | "success" | "error"
}): PatchFrame {
  return {
    type: "patch",
    patch: {
      cursor: input.cursor,
      type: "chat.tool.upsert",
      sessionKey: input.sessionKey ?? "s1",
      payload: {
        semanticType: "chat.tool.upsert",
        runId: input.runId,
        toolCall: {
          id: input.toolId,
          toolCallId: input.toolId,
          name: "shell",
          status: input.status ?? "running",
          phase: input.status === "success" ? "result" : "running",
        },
      },
      createdAtMs: 1,
    },
  } as PatchFrame
}

describe("derivePatchTargetSeq (BUG-1)", () => {
  test("returns payload.messageSeq when present (per-session seq)", () => {
    const frame = makeMessageUpsertFrame({
      cursor: 10_000, // global cursor — irrelevant to the answer
      messageId: "m-30",
      messageSeq: 30,
    })
    expect(derivePatchTargetSeq(frame, [])).toBe(30)
  })

  test("falls back to in-window message gatewayIndex when payload omits seq", () => {
    const frame = makeMessageUpsertFrame({
      cursor: 10_000,
      messageId: "m-30",
    })
    const messages = [
      makeMessage({
        messageId: "m-30",
        role: "assistant",
        text: "",
        createdAt: "",
        gatewayIndex: 30,
      }),
    ]
    expect(derivePatchTargetSeq(frame, messages)).toBe(30)
  })

  test("tool patch resolves to parent user message's seq via runId", () => {
    const frame = makeToolPatchFrame({
      cursor: 10_000,
      runId: "R1",
      toolId: "t1",
      status: "running",
    })
    const messages = [
      makeMessage({
        messageId: "u-30",
        role: "user",
        text: "do thing",
        createdAt: "",
        gatewayIndex: 30,
        runId: "R1",
      }),
    ]
    expect(derivePatchTargetSeq(frame, messages)).toBe(30)
  })

  test("returns undefined when no seq is derivable (cannot drop safely)", () => {
    const frame = makeToolPatchFrame({
      cursor: 10_000,
      runId: "R-unknown",
      toolId: "t1",
    })
    expect(derivePatchTargetSeq(frame, [])).toBeUndefined()
  })
})

describe("shouldDropPatchAsEvicted with per-session seq (BUG-1)", () => {
  test("does not drop patch when target row is in window even with global cursor >> seq", () => {
    // BUG-1 scenario: user scrolled up. newestLoadedSeq=50, hasNewer=true.
    // A live patch targeting an in-window message (seq 30) arrives.
    // The global frame.patch.cursor is 10,000 (other sessions have been
    // active for hours). The patch must apply.
    const frame = makeMessageUpsertFrame({
      cursor: 10_000,
      messageId: "m-30",
      messageSeq: 30,
    })
    const target = derivePatchTargetSeq(frame, [])
    expect(target).toBe(30)
    const drop = shouldDropPatchAsEvicted({
      patchTargetSeq: target,
      newestLoadedSeq: 50,
      hasNewer: true,
    })
    expect(drop).toBe(false)
  })

  test("drops patch when target seq is beyond newestLoadedSeq (true eviction case)", () => {
    const frame = makeMessageUpsertFrame({
      cursor: 10_000,
      messageId: "m-75",
      messageSeq: 75,
    })
    const target = derivePatchTargetSeq(frame, [])
    expect(target).toBe(75)
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: target,
        newestLoadedSeq: 50,
        hasNewer: true,
      }),
    ).toBe(true)
  })

  test("undefined target seq (no anchor) is treated as 'do not drop' (apply patch)", () => {
    expect(
      shouldDropPatchAsEvicted({
        patchTargetSeq: undefined,
        newestLoadedSeq: 50,
        hasNewer: true,
      }),
    ).toBe(false)
  })
})
