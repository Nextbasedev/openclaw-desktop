import { describe, expect, test } from "vitest"
import { CHAT_BOOTSTRAP_MESSAGE_LIMIT, CHAT_OLDER_PAGE_LIMIT, activeSessionMessages, canonicalMessagesFromRawHistory, dataSourceAfterWarmCacheApplied, mergeActiveBootstrapTimeline, mergeActivePreservedReconcileMessages, mergeOptimisticMessagesWithCanonical, mergePaginatedRawHistory, shouldApplyBootstrapRecoveryReload, shouldPreserveActiveBootstrapTimeline, shouldPreserveActiveReconcile, shouldPreserveTimelineStoreRows, timelineMessageChanged } from "../../hooks/useChatMessages"
import { dedupeChatMessages } from "../chatMessageDedupe"
import { parseChatHistory } from "../chatHistoryParser"
import type { ChatMessage } from "@/components/ChatView/types"

const user = (text = "question"): ChatMessage => ({ messageId: `u-${text}`, role: "user", text })
const optimisticUser = (text = "question"): ChatMessage => ({
  messageId: `optimistic-${text}`,
  role: "user",
  text,
  isOptimistic: true,
  sendStatus: "sending",
})
const assistant = (text = "answer"): ChatMessage => ({ messageId: `a-${text}`, role: "assistant", text })
const rawText = (seq: number, role: "user" | "assistant", text: string) => ({
  role,
  content: [{ type: "text", text }],
  __openclaw: { id: `${role}-${seq}`, seq },
})

describe("chat reconcile active-state guards", () => {
  test("preserves tool_running when legacy reconcile reports idle but tools are still running", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "tool_running",
      nextStatus: "idle",
      candidateMessages: [user(), assistant()],
      runningToolCount: 3,
    })).toBe(true)
  })

  test("preserves active status while no assistant answer exists after latest user", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "thinking",
      nextStatus: "idle",
      candidateMessages: [user()],
      runningToolCount: 0,
    })).toBe(true)
  })

  test("preserves active status when stale reconcile has fewer messages than visible chat", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "tool_running",
      nextStatus: "idle",
      candidateMessages: [user(), assistant()],
      runningToolCount: 0,
      currentMessageCount: 10,
      freshMessageCount: 6,
    })).toBe(true)
  })

  test("allows idle reconcile after an answer when no tools are running", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "streaming",
      nextStatus: "idle",
      candidateMessages: [user(), assistant()],
      runningToolCount: 0,
    })).toBe(false)
  })

  test("keeps a newly sent optimistic user message when canonical bootstrap is still empty", () => {
    expect(mergeOptimisticMessagesWithCanonical([], [optimisticUser("long task")])).toMatchObject([
      { role: "user", text: "long task", isOptimistic: true },
    ])
  })

  test("drops optimistic user message once canonical has the same user text and matching send time", () => {
    const sentAt = "2026-05-28T04:59:00.000Z"
    expect(mergeOptimisticMessagesWithCanonical(
      [{ ...user("long task"), messageId: "canonical-user", createdAt: sentAt }],
      [{ ...optimisticUser("long task"), createdAt: sentAt }]
    )).toMatchObject([
      { messageId: "canonical-user", role: "user", text: "long task" },
    ])
  })

  test("merges newer canonical rows while preserving active reconcile state", () => {
    const current = [
      user("ask"),
      { ...assistant(""), messageId: "tool-row", toolCalls: [{ id: "exec-1", tool: "exec", status: "running" as const }] },
    ]
    const fresh = [
      user("ask"),
      assistant("final answer"),
      user("follow up"),
    ]

    const merged = mergeActivePreservedReconcileMessages(current, fresh)

    expect(merged.map((message) => message.text)).toEqual(["ask", "final answer", "follow up", ""])
    expect(merged.some((message) => message.toolCalls?.some((tool) => tool.id === "exec-1"))).toBe(true)
  })

  test("does not replace active messages with shorter stale reconcile history", () => {
    const current = [user("ask"), assistant("answer"), user("next")]
    const fresh = [user("ask")]

    expect(mergeActivePreservedReconcileMessages(current, fresh)).toBe(current)
  })

  test("preserves timeline rows during active streaming/tool states and older loads", () => {
    expect(shouldPreserveTimelineStoreRows({ loadingOlderMessages: false, status: "thinking" })).toBe(true)
    expect(shouldPreserveTimelineStoreRows({ loadingOlderMessages: false, status: "tool_running" })).toBe(true)
    expect(shouldPreserveTimelineStoreRows({ loadingOlderMessages: true, status: "done" })).toBe(true)
    expect(shouldPreserveTimelineStoreRows({ loadingOlderMessages: false, status: "done" })).toBe(false)
  })

  test("Phase 2: preserves active bootstrap timeline when local list is longer or optimistic", () => {
    expect(shouldPreserveActiveBootstrapTimeline({
      status: "thinking",
      localMessageCount: 160,
      bootstrapMessageCount: 160,
      hasOptimisticOrSending: true,
    })).toBe(true)
    expect(shouldPreserveActiveBootstrapTimeline({
      status: "streaming",
      localMessageCount: 162,
      bootstrapMessageCount: 160,
    })).toBe(true)
    expect(shouldPreserveActiveBootstrapTimeline({
      status: "done",
      localMessageCount: 162,
      bootstrapMessageCount: 160,
    })).toBe(false)
    expect(shouldPreserveActiveBootstrapTimeline({
      status: "idle",
      localMessageCount: 0,
      bootstrapMessageCount: 160,
    })).toBe(false)
  })

  test("Phase 2: merge active bootstrap never drops live-only rows for a shorter window", () => {
    const local = [
      user("imported-1"),
      assistant("imported-2"),
      optimisticUser("just sent"),
    ]
    const bootstrap = [user("imported-1"), assistant("imported-2")]
    const merged = mergeActiveBootstrapTimeline(local, bootstrap)
    expect(merged.some((m) => m.text === "just sent" && m.isOptimistic)).toBe(true)
    expect(merged.length).toBeGreaterThanOrEqual(local.length)
  })

  test("Phase 2: bootstrap recovery reload is skipped during active run with user message", () => {
    expect(shouldApplyBootstrapRecoveryReload({ status: "thinking", hasUserMessage: true })).toBe(false)
    expect(shouldApplyBootstrapRecoveryReload({ status: "streaming", hasUserMessage: true })).toBe(false)
    expect(shouldApplyBootstrapRecoveryReload({ status: "tool_running", hasUserMessage: true })).toBe(false)
    expect(shouldApplyBootstrapRecoveryReload({ status: "thinking", hasUserMessage: false })).toBe(true)
    expect(shouldApplyBootstrapRecoveryReload({ status: "done", hasUserMessage: true })).toBe(true)
  })

  test("detects live tool/status changes even when assistant text is unchanged", () => {
    const base = {
      messageId: "a-tool",
      role: "assistant" as const,
      text: "",
      toolCalls: [{ id: "tc-1", tool: "exec", status: "running" as const }],
    }
    expect(timelineMessageChanged(base, {
      ...base,
      toolCalls: [{ id: "tc-1", tool: "exec", status: "success" as const, resultText: "ok" }],
    })).toBe(true)
  })

  test("does not expose warm-cache reloads as an indefinite syncing state", () => {
    expect(dataSourceAfterWarmCacheApplied()).toBe("warm-cache")
  })

  test("bootstrap history limits are unbounded for full-session loading", () => {
    expect(CHAT_BOOTSTRAP_MESSAGE_LIMIT).toBe(Number.MAX_SAFE_INTEGER)
    expect(CHAT_OLDER_PAGE_LIMIT).toBe(Number.MAX_SAFE_INTEGER)
  })

  test("keeps current-session timeline rows visible while older history loads", () => {
    const current = [user("visible-current-session-message")]

    expect(activeSessionMessages({
      messages: current,
      messageSessionKey: "session-a",
      sessionKey: "session-a",
    })).toBe(current)
    expect(activeSessionMessages({
      messages: current,
      messageSessionKey: "session-a",
      sessionKey: "session-b",
    })).toEqual([])
  })

  test("reparses combined raw history so page boundaries do not split one assistant turn", () => {
    const sessionKey = "session-boundary"
    const olderRaw = [
      rawText(1, "user", "first question"),
      rawText(2, "assistant", "part one"),
    ]
    const bootstrapRaw = [
      rawText(3, "assistant", "part two"),
      rawText(4, "user", "second question"),
      rawText(5, "assistant", "second answer"),
    ]

    const currentMessages = canonicalMessagesFromRawHistory(sessionKey, bootstrapRaw as never[])
    const oldSeparateMerge = dedupeChatMessages([
      ...parseChatHistory(olderRaw as never[]).messages,
      ...currentMessages,
    ])
    const merged = mergePaginatedRawHistory({
      sessionKey,
      existingRawMessages: bootstrapRaw as never[],
      olderPageRows: olderRaw.map((message) => ({
        openclawSeq: message.__openclaw.seq,
        gatewaySeq: null,
        segmentId: null,
        messageId: message.__openclaw.id,
        role: message.role,
        data: message,
      })),
      currentMessages,
    }).messages

    expect(oldSeparateMerge).toHaveLength(5)
    expect(merged).toHaveLength(4)
    expect(merged[1]).toMatchObject({ role: "assistant" })
    expect(merged[1]?.text).toContain("part one")
    expect(merged[1]?.text).toContain("part two")
  })

})
