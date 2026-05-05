import { describe, expect, it } from "vitest"
import { composerReducer, initialComposerState } from "./composerState"

describe("composer state", () => {
  it("starts normal sends immediately instead of entering a delayed batch phase", () => {
    const state = composerReducer(initialComposerState, {
      type: "send_start",
      generating: false,
      payload: { text: "hello" },
    })

    expect(state.phase).toBe("sending")
    expect(state.pendingText).toBe("hello")
  })
})
