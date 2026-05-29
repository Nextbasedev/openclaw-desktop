import { describe, expect, it } from "vitest"
import { createInitialState, editorGroupsReducer } from "../editorGroups"

const chatTab = (id: string) => ({
  id: `chat:${id}`,
  title: `Chat ${id}`,
  subtitle: "Chat",
  kind: "chat" as const,
  chat: { id, name: `Chat ${id}`, sessionKey: `agent:main:desktop:${id}` },
})

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

  it("does not create a new state object when adding an already active unchanged tab", () => {
    const state = createInitialState(chatTab("a"))

    const next = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("a") })

    expect(next).toBe(state)
  })

  it("reorders tabs inside the same group without changing the active tab", () => {
    let state = createInitialState(chatTab("a"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("b") })
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("c") })
    state = editorGroupsReducer(state, { type: "SET_ACTIVE_TAB", groupId: "group-1", tabId: "chat:a" })

    const next = editorGroupsReducer(state, {
      type: "REORDER_TAB",
      groupId: "group-1",
      tabId: "chat:c",
      targetIndex: 0,
    })

    expect(next.groups[0]?.tabs.map((tab) => tab.id)).toEqual(["chat:c", "chat:a", "chat:b"])
    expect(next.groups[0]?.activeTabId).toBe("chat:a")
  })

  it("moves tabs between split groups at the dropped position", () => {
    let state = createInitialState(chatTab("a"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("b") })
    state = editorGroupsReducer(state, {
      type: "SPLIT_TAB",
      tabId: "chat:b",
      sessionData: null,
    })
    state = editorGroupsReducer(state, { type: "ADD_TAB", groupId: "group-2", tab: chatTab("c") })

    const next = editorGroupsReducer(state, {
      type: "MOVE_TAB",
      tabId: "chat:a",
      sourceGroupId: "group-1",
      targetGroupId: "group-2",
      targetIndex: 1,
    })

    expect(next.groups[0]?.id).toBe("group-2")
    expect(next.groups[0]?.tabs.map((tab) => tab.id)).toEqual(["chat:b", "chat:a", "chat:c"])
    expect(next.groups[0]?.activeTabId).toBe("chat:a")
  })
})
