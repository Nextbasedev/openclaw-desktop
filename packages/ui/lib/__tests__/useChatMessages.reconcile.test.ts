import { describe, expect, test } from "vitest"
import { CHAT_BOOTSTRAP_MESSAGE_LIMIT, CHAT_OLDER_PAGE_LIMIT, dataSourceAfterWarmCacheApplied, mergeActivePreservedReconcileMessages, mergeOptimisticMessagesWithCanonical, shouldPreserveActiveReconcile, shouldPreserveTimelineStoreRows, timelineMessageChanged } from "../../hooks/useChatMessages"
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

  test("keeps older history page length aligned with bootstrap page length", () => {
    expect(CHAT_OLDER_PAGE_LIMIT).toBe(CHAT_BOOTSTRAP_MESSAGE_LIMIT)
    expect(CHAT_OLDER_PAGE_LIMIT).toBe(160)
  })
})
