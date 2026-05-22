import { describe, expect, test } from "vitest"
import { mergeOptimisticMessagesWithCanonical, shouldPreserveActiveReconcile } from "../../hooks/useChatMessages"
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

  test("drops optimistic user message once canonical has the same user text", () => {
    expect(mergeOptimisticMessagesWithCanonical(
      [{ ...user("long task"), messageId: "canonical-user" }],
      [optimisticUser("long task")]
    )).toMatchObject([
      { messageId: "canonical-user", role: "user", text: "long task" },
    ])
  })
})
