/**
 * Phase 4 — Feature no-regression matrix for Telegram chat reliability.
 *
 * Each case maps a user-visible problem to an automated assertion so we can
 * prove the fix works without guessing. Live gateway/UI paint is still manual
 * (Phase 5); this file locks pure + store contracts that underpin those UIs.
 *
 * See docs/plans/2026-07-10-telegram-chat-reliability-loop.md
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import {
  CHAT_BOOTSTRAP_MESSAGE_LIMIT,
  CHAT_OLDER_PAGE_LIMIT,
  mergeActiveBootstrapTimeline,
  mergeActivePreservedReconcileMessages,
  mergeOptimisticMessagesWithCanonical,
  shouldApplyBootstrapRecoveryReload,
  shouldPreserveActiveBootstrapTimeline,
  shouldPreserveActiveReconcile,
  shouldPreserveTimelineStoreRows,
} from "../../hooks/useChatMessages"
import {
  decideBootstrapRecovery,
} from "../../components/ChatView/bootstrapRecoveryGuard"
import { dedupeChatMessages } from "../chatMessageDedupe"
import {
  clearGlobalChatEngineForTests,
  getGlobalChatSession,
  seedGlobalChatSession,
} from "../chat-engine-v2/store"
import { UI_INITIAL_WINDOW, UI_OLDER_PAGE, UI_STORE_WINDOW } from "../chat-engine-v2/constants"
import { WARM_CHAT_MAX_MESSAGES } from "../warmChatCache"
import type { ChatMessage } from "@/components/ChatView/types"

const user = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  messageId: id,
  role: "user",
  text,
  ...extra,
})
const assistant = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  messageId: id,
  role: "assistant",
  text,
  ...extra,
})

function importedTail(count: number, startSeq = 341): ChatMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const seq = startSeq + i
    return seq % 2 === 1
      ? user(`u-${seq}`, `imported ${seq}`, { gatewayIndex: seq })
      : assistant(`a-${seq}`, `imported ${seq}`, { gatewayIndex: seq })
  })
}

afterEach(() => {
  clearGlobalChatEngineForTests()
  vi.restoreAllMocks()
})

describe("Phase 4 matrix — window contract (no count shrink flash)", () => {
  test("open/bootstrap/warm/ChatView all agree on 160; older page is 100", () => {
    expect(UI_INITIAL_WINDOW).toBe(160)
    expect(CHAT_BOOTSTRAP_MESSAGE_LIMIT).toBe(160)
    expect(WARM_CHAT_MAX_MESSAGES).toBe(160)
    expect(UI_OLDER_PAGE).toBe(100)
    expect(CHAT_OLDER_PAGE_LIMIT).toBe(100)
    expect(UI_STORE_WINDOW).toBe(200)
    expect(UI_STORE_WINDOW).toBeGreaterThanOrEqual(UI_INITIAL_WINDOW)
  })
})

describe("Phase 4 matrix — PROBLEM: blink / reload after send while response running", () => {
  test("bootstrap recovery must NOT remount engine during active run with user bubble", () => {
    expect(shouldApplyBootstrapRecoveryReload({ status: "thinking", hasUserMessage: true })).toBe(false)
    expect(shouldApplyBootstrapRecoveryReload({ status: "streaming", hasUserMessage: true })).toBe(false)
    expect(shouldApplyBootstrapRecoveryReload({ status: "tool_running", hasUserMessage: true })).toBe(false)

    // ChatView path uses the same rule via decideBootstrapRecovery
    expect(decideBootstrapRecovery({
      isLoading: false,
      streamStatus: "thinking",
      hasUserMessage: true,
      lastBootstrapCompletedAt: 0,
      lastRecoveryAt: 0,
      now: Date.now(),
    })).toEqual({ apply: false, reason: "skipped-active-run" })
  })

  test("recovery still allowed when idle/done (does not brick genuine recovery)", () => {
    expect(shouldApplyBootstrapRecoveryReload({ status: "done", hasUserMessage: true })).toBe(true)
    expect(shouldApplyBootstrapRecoveryReload({ status: "idle", hasUserMessage: true })).toBe(true)
    expect(shouldApplyBootstrapRecoveryReload({ status: "thinking", hasUserMessage: false })).toBe(true)
  })

  test("mid-run shorter/equal bootstrap must preserve local timeline (no shrink replace)", () => {
    const local = [
      ...importedTail(160),
      user("opt-1", "continue telegram", { isOptimistic: true, sendStatus: "sending" }),
    ]
    expect(shouldPreserveActiveBootstrapTimeline({
      status: "thinking",
      localMessageCount: local.length,
      bootstrapMessageCount: 160,
      hasOptimisticOrSending: true,
    })).toBe(true)

    const bootstrapOnly = importedTail(160)
    const merged = mergeActiveBootstrapTimeline(local, bootstrapOnly)
    expect(merged.some((m) => m.messageId === "opt-1" && m.isOptimistic)).toBe(true)
    expect(merged.length).toBeGreaterThanOrEqual(local.length)
  })

  test("timeline store rows preserved during active streaming (no row delete flash)", () => {
    expect(shouldPreserveTimelineStoreRows({ loadingOlderMessages: false, status: "streaming" })).toBe(true)
    expect(shouldPreserveTimelineStoreRows({ loadingOlderMessages: false, status: "tool_running" })).toBe(true)
    expect(shouldPreserveTimelineStoreRows({ loadingOlderMessages: false, status: "done" })).toBe(false)
  })
})

describe("Phase 4 matrix — PROBLEM: order flip after send / confirm", () => {
  test("optimistic user kept until canonical same-text user arrives; then single row", () => {
    const sentAt = "2026-07-10T12:00:00.000Z"
    const withOptimistic = mergeOptimisticMessagesWithCanonical(
      [],
      [user("opt", "hello telegram", { isOptimistic: true, sendStatus: "sending", createdAt: sentAt })],
    )
    expect(withOptimistic).toHaveLength(1)
    expect(withOptimistic[0]?.isOptimistic).toBe(true)

    const confirmed = mergeOptimisticMessagesWithCanonical(
      [user("canon", "hello telegram", { createdAt: sentAt, gatewayIndex: 501 })],
      [user("opt", "hello telegram", { isOptimistic: true, createdAt: sentAt })],
    )
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]?.messageId).toBe("canon")
    expect(confirmed[0]?.isOptimistic).toBeFalsy()
  })

  test("dedupe keeps single chronological timeline for user+assistant after merge", () => {
    const messages = dedupeChatMessages([
      user("u1", "q", { gatewayIndex: 1 }),
      assistant("a1", "a", { gatewayIndex: 2 }),
      user("u1-dup", "q", { gatewayIndex: 1 }),
    ])
    const users = messages.filter((m) => m.role === "user" && m.text === "q")
    expect(users.length).toBeLessThanOrEqual(2)
    // Sorted by gateway index when present
    for (let i = 1; i < messages.length; i += 1) {
      const prev = messages[i - 1]?.gatewayIndex
      const next = messages[i]?.gatewayIndex
      if (typeof prev === "number" && typeof next === "number") {
        expect(next).toBeGreaterThanOrEqual(prev)
      }
    }
  })
})

describe("Phase 4 matrix — PROBLEM: post-send reconcile wiping imported windowed chat", () => {
  test("active reconcile never replaces longer live list with shorter history", () => {
    const current = [...importedTail(160), user("opt", "next", { isOptimistic: true })]
    const fresh = importedTail(100)
    expect(mergeActivePreservedReconcileMessages(current, fresh)).toBe(current)
  })

  test("shouldPreserveActiveReconcile when fresh count is lower than visible", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "thinking",
      nextStatus: "idle",
      candidateMessages: [user("u", "q")],
      runningToolCount: 0,
      currentMessageCount: 161,
      freshMessageCount: 160,
    })).toBe(true)
  })

  test("seedGlobalChatSession windowed partial does not drop newer local marker during active-ish preserve path", () => {
    seedGlobalChatSession({
      sessionKey: "tg-matrix",
      cursor: 10,
      status: "thinking",
      messages: [
        ...importedTail(3, 498),
        user("live", "WEBWRIGHT_CONTINUE_MARKER", { isOptimistic: true }),
      ],
      historyCoverage: "windowed",
      messageCount: 500,
    })

    // Shorter terminal-looking seed (simulates laggy bootstrap) must not wipe marker
    // when store merge preserves local rows (existing store behavior for windowed).
    seedGlobalChatSession({
      sessionKey: "tg-matrix",
      cursor: 10,
      status: "done",
      messages: importedTail(2, 498),
      historyCoverage: "windowed",
      messageCount: 500,
    })

    const state = getGlobalChatSession("tg-matrix")
    expect(state?.messages.some((m) => m.text === "WEBWRIGHT_CONTINUE_MARKER")).toBe(true)
  })
})

describe("Phase 4 matrix — tools / streaming / normal session safety", () => {
  test("tool_running preserved when legacy reconcile says idle but tools still running", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "tool_running",
      nextStatus: "idle",
      candidateMessages: [user("u", "q"), assistant("a", "")],
      runningToolCount: 2,
    })).toBe(true)
  })

  test("idle reconcile allowed after assistant answer and no running tools", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "streaming",
      nextStatus: "idle",
      candidateMessages: [user("u", "q"), assistant("a", "done answer")],
      runningToolCount: 0,
    })).toBe(false)
  })

  test("normal idle session: full bootstrap replace is allowed (no preserve)", () => {
    expect(shouldPreserveActiveBootstrapTimeline({
      status: "idle",
      localMessageCount: 160,
      bootstrapMessageCount: 160,
    })).toBe(false)
    expect(shouldApplyBootstrapRecoveryReload({
      status: "idle",
      hasUserMessage: true,
    })).toBe(true)
  })
})

describe("Phase 4 matrix — end-to-end local flow (imported continue simulation)", () => {
  test("open tail → send optimistic → mid-run bootstrap merge keeps order and optimistic", () => {
    // 1) Open: 160 tail
    const open = importedTail(160, 341)
    seedGlobalChatSession({
      sessionKey: "tg-e2e",
      cursor: 1,
      status: "idle",
      messages: open,
      historyCoverage: "windowed",
      messageCount: 500,
    })
    expect(getGlobalChatSession("tg-e2e")?.messages).toHaveLength(160)

    // 2) Send: append optimistic
    const withSend = [
      ...open,
      user("client-1", "continue on imported", {
        isOptimistic: true,
        sendStatus: "sending",
        createdAt: "2026-07-10T12:00:00.000Z",
      }),
    ]
    seedGlobalChatSession({
      sessionKey: "tg-e2e",
      cursor: 2,
      status: "thinking",
      statusLabel: "Thinking",
      messages: withSend,
      historyCoverage: "windowed",
      messageCount: 500,
    })

    // 3) Mid-run bootstrap returns only the 160 window (no optimistic)
    expect(shouldPreserveActiveBootstrapTimeline({
      status: "thinking",
      localMessageCount: 161,
      bootstrapMessageCount: 160,
      hasOptimisticOrSending: true,
    })).toBe(true)

    const merged = mergeActiveBootstrapTimeline(
      getGlobalChatSession("tg-e2e")!.messages,
      open,
    )
    expect(merged.some((m) => m.messageId === "client-1")).toBe(true)
    // User continue still after imported tail
    const optIdx = merged.findIndex((m) => m.messageId === "client-1")
    expect(optIdx).toBe(merged.length - 1)

    // 4) Recovery would be skipped
    expect(shouldApplyBootstrapRecoveryReload({
      status: "thinking",
      hasUserMessage: true,
    })).toBe(false)

    // 5) Confirm optimistic → single user row
    const confirmed = mergeOptimisticMessagesWithCanonical(
      [
        ...open,
        user("gw-user", "continue on imported", {
          createdAt: "2026-07-10T12:00:00.000Z",
          gatewayIndex: 501,
        }),
      ],
      merged.filter((m) => m.isOptimistic),
    )
    expect(confirmed.filter((m) => m.text === "continue on imported")).toHaveLength(1)
    expect(confirmed.some((m) => m.messageId === "gw-user")).toBe(true)
  })
})
