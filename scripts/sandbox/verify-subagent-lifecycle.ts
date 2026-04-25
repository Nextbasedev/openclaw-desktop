import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  reduceSubagentLifecycle,
  type SubagentLifecycleState,
} from "../../packages/ui/lib/subagentLifecycle"

const childKey = "agent:main:subagent:123e4567-e89b-12d3-a456-426614174000"

function state(
  map: Map<string, SubagentLifecycleState>,
  toolCallId: string,
) {
  const value = map.get(toolCallId)
  assert.ok(value, `missing sub-agent ${toolCallId}`)
  return value
}

let agents = new Map<string, SubagentLifecycleState>()
agents = reduceSubagentLifecycle(agents, {
  type: "spawn_started",
  toolCallId: "spawn-1",
  label: "research",
  task: "Find the source.",
})

agents = reduceSubagentLifecycle(agents, { type: "parent_done" })
assert.equal(state(agents, "spawn-1").status, "spawning")
assert.equal(state(agents, "spawn-1").openEnabled, false)

agents = reduceSubagentLifecycle(agents, {
  type: "spawn_done",
  toolCallId: "spawn-1",
  payload: { childSessionKey: "not-a-subagent-session" },
})
assert.equal(state(agents, "spawn-1").status, "linking")
assert.equal(state(agents, "spawn-1").openEnabled, false)

agents = reduceSubagentLifecycle(agents, {
  type: "spawn_linked",
  toolCallId: "spawn-1",
  payload: { childSessionKey: childKey },
})
assert.equal(state(agents, "spawn-1").status, "working")
assert.equal(state(agents, "spawn-1").childSessionKey, childKey)
assert.equal(state(agents, "spawn-1").openEnabled, true)

agents = reduceSubagentLifecycle(agents, {
  type: "child_yield",
  toolCallId: "spawn-1",
})
assert.equal(state(agents, "spawn-1").status, "completed")

agents = reduceSubagentLifecycle(agents, {
  type: "spawn_started",
  toolCallId: "spawn-2",
  label: "research",
})
agents = reduceSubagentLifecycle(agents, {
  type: "spawn_started",
  toolCallId: "spawn-3",
  label: "research",
})
assert.equal(agents.size, 3)
assert.equal(state(agents, "spawn-2").label, state(agents, "spawn-3").label)
assert.notEqual(state(agents, "spawn-2").id, state(agents, "spawn-3").id)

agents = reduceSubagentLifecycle(agents, {
  type: "child_error",
  toolCallId: "spawn-2",
})
assert.equal(state(agents, "spawn-2").status, "failed")

const chatHook = readFileSync(
  join(process.cwd(), "packages/ui/hooks/useChatMessages.ts"),
  "utf8",
)
assert.equal(
  chatHook.includes("seenUserLines"),
  false,
  "repeated user prompts must not be collapsed by text de-duping",
)

console.log("subagent lifecycle checks passed")
