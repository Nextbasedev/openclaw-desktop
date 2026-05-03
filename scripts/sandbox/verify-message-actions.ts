import assert from "node:assert/strict"
import {
  exportMessagesMarkdown,
  initialMessageActionState,
  messageActionReducer,
  pinnedMessages,
  quotePrefix,
  visibleMessages,
} from "../../packages/ui/lib/messageActions"
import type { ChatMessage } from "../../packages/ui/components/ChatView/types"

const messages: ChatMessage[] = [
  { messageId: "u1", role: "user", text: "Hello" },
  { messageId: "a1", role: "assistant", text: "Hi\nthere" },
]

let state = messageActionReducer(initialMessageActionState, {
  type: "pin",
  messageId: "a1",
})
assert.deepEqual(pinnedMessages(messages, state).map((m) => m.messageId), ["a1"])

state = messageActionReducer(state, {
  type: "react",
  messageId: "a1",
  reaction: "up",
})
assert.equal(state.reactions.a1, "up")

state = messageActionReducer(state, { type: "reply", messageId: "a1" })
assert.equal(state.replyToId, "a1")

state = messageActionReducer(state, { type: "delete", messageId: "u1" })
assert.deepEqual(visibleMessages(messages, state).map((m) => m.messageId), ["a1"])
assert.equal(quotePrefix("one\ntwo"), "> one\n> two")
assert.match(exportMessagesMarkdown(messages), /## User/)
assert.match(exportMessagesMarkdown(messages), /## Assistant/)

console.log("message action checks passed")
