import { describe, expect, test } from "vitest"
import type { ChatMessage } from "@/components/ChatView/types"
import {
  hasAssistantAnswerAfterLatestUserMessage,
  mergeOptimisticMessagesWithCanonical,
  shouldPreserveActiveReconcile,
} from "../reconcile"

const user = (text = "question"): ChatMessage => ({ messageId: `u-${text}`, role: "user", text })
const optimisticUser = (text = "question"): ChatMessage => ({
  messageId: `optimistic-${text}`,
  role: "user",
  text,
  isOptimistic: true,
  sendStatus: "sending",
})
const assistant = (text = "answer"): ChatMessage => ({ messageId: `a-${text}`, role: "assistant", text })

describe("chat runtime reconcile guards", () => {
  test("detects whether the latest user turn has an assistant answer", () => {
    expect(hasAssistantAnswerAfterLatestUserMessage([user(), assistant()])).toBe(true)
    expect(hasAssistantAnswerAfterLatestUserMessage([user(), assistant(), user("second")])).toBe(false)
    expect(hasAssistantAnswerAfterLatestUserMessage([assistant()])).toBe(true)
  })

  test("preserves active status while stale reconcile has no answer after latest user", () => {
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

  test("allows idle reconcile after answer when no tools are running", () => {
    expect(shouldPreserveActiveReconcile({
      currentStatus: "streaming",
      nextStatus: "idle",
      candidateMessages: [user(), assistant()],
      runningToolCount: 0,
    })).toBe(false)
  })

  test("keeps optimistic user while canonical bootstrap is empty", () => {
    expect(mergeOptimisticMessagesWithCanonical([], [optimisticUser("long task")])).toMatchObject([
      { role: "user", text: "long task", isOptimistic: true },
    ])
  })

  test("drops optimistic user after canonical echo with same text arrives", () => {
    expect(mergeOptimisticMessagesWithCanonical(
      [{ ...user("long task"), messageId: "canonical-user" }],
      [optimisticUser("long task")],
    )).toMatchObject([
      { messageId: "canonical-user", role: "user", text: "long task" },
    ])
  })
})
