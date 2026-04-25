import assert from "node:assert/strict"
import {
  composeBatch,
  composerReducer,
  initialComposerState,
} from "../../packages/ui/lib/composerState"

const first = { text: "first" }
const second = { text: "second" }
const withAttachment = {
  text: "third",
  attachments: [{
    name: "a.txt",
    mimeType: "text/plain",
    content: "hello",
    encoding: "utf-8" as const,
    size: 5,
  }],
}

let state = composerReducer(initialComposerState, {
  type: "send_start",
  payload: first,
  generating: false,
})
assert.equal(state.phase, "sending")
assert.equal(state.pendingText, "first")

state = composerReducer(state, {
  type: "send_failed",
  error: "Network failed",
})
assert.equal(state.phase, "failed")
assert.equal(state.pendingText, "first")
assert.equal(state.error, "Network failed")

state = composerReducer(state, {
  type: "send_start",
  payload: second,
  generating: true,
})
assert.equal(state.phase, "restarting")
assert.equal(state.interrupted, true)

state = composerReducer(initialComposerState, {
  type: "batch_add",
  payload: first,
})
state = composerReducer(state, { type: "batch_add", payload: withAttachment })
assert.equal(state.phase, "batched")
assert.equal(state.batch.length, 2)
assert.deepEqual(composeBatch(state.batch), {
  text: "first\n\nthird",
  attachments: withAttachment.attachments,
})

console.log("composer lifecycle checks passed")
