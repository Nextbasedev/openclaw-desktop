import { describe, expect, it } from "vitest"
import { createInitialState, editorGroupsReducer } from "../editorGroups"

describe("editorGroupsReducer", () => {
  it("keeps focused session data in sync when adding a chat tab", () => {
    const state = createInitialState()
    const next = editorGroupsReducer(state, {
      type: "ADD_TAB",
      tab: {
        id: "chat:c1",
        title: "Current chat",
        subtitle: "Chat",
        kind: "chat",
        chat: { id: "c1", name: "Current chat", sessionKey: "agent:main:desktop:c1" },
      },
    })

    expect(next.groups[0]?.activeTabId).toBe("chat:c1")
    expect(next.groups[0]?.sessionData).toEqual({
      chat: { id: "c1", name: "Current chat", sessionKey: "agent:main:desktop:c1" },
      sessionKey: "agent:main:desktop:c1",
      title: "Current chat",
    })
  })
})
