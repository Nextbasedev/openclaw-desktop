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

  it("reorders tabs inside the same group", () => {
    let state = createInitialState(chatTab("a"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("b") })
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("c") })

    const next = editorGroupsReducer(state, {
      type: "REORDER_TAB",
      groupId: "group-1",
      tabId: "chat:c",
      targetIndex: 0,
    })

    expect(next.groups[0]?.tabs.map((tab) => tab.id)).toEqual(["chat:c", "chat:a", "chat:b"])
    expect(next.groups[0]?.activeTabId).toBe("chat:c")
  })

  it("sets tab order from a reordered tab id list", () => {
    let state = createInitialState(chatTab("a"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("b") })
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("c") })

    const next = editorGroupsReducer(state, {
      type: "SET_TAB_ORDER",
      groupId: "group-1",
      tabIds: ["chat:b", "chat:c", "chat:a"],
    })

    expect(next.groups[0]?.tabs.map((tab) => tab.id)).toEqual(["chat:b", "chat:c", "chat:a"])
    expect(next.groups[0]?.activeTabId).toBe("chat:c")
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
