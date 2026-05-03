import assert from "node:assert/strict"
import { parseChatHistory } from "../../packages/ui/lib/chatHistoryParser"

const childSessionKey = "agent:main:subagent:research-1"

const parsed = parseChatHistory([
  { id: "u1", role: "user", text: "same prompt" },
  { id: "u2", role: "user", text: "same prompt" },
  {
    id: "a1",
    role: "assistant",
    content: [
      {
        type: "toolCall",
        id: "spawn-1",
        name: "sessions_spawn",
        input: { label: "research", task: "inspect repo" },
      },
    ],
  },
  {
    id: "t1",
    role: "tool",
    text: JSON.stringify({ childSessionKey }),
  },
  {
    id: "a2",
    role: "assistant",
    content: [
      { type: "toolCall", id: "read-1", name: "read", input: {} },
    ],
  },
  { id: "t2", role: "tool", text: "ok" },
  { id: "a3", role: "assistant", text: "Done" },
])

assert.equal(parsed.messages.filter((m) => m.role === "user").length, 2)
assert.equal(parsed.messages[0].text, "same prompt")
assert.equal(parsed.messages[1].text, "same prompt")
assert.equal(parsed.subagents.length, 1)
assert.equal(parsed.subagents[0].sessionKey, childSessionKey)
assert.equal(parsed.subagents[0].status, "working")
assert.ok(
  parsed.messages.some((message) =>
    message.toolCalls?.some((call) => call.tool === "read"),
  ),
)

console.log("chat parsing checks passed")
