import { describe, expect, it } from "vitest"
import { createInitialState, editorGroupsReducer, getFocusedGroup, type EditorTab } from "./editorGroups"

const chatTab = (id: string, title = "Chat"): EditorTab => ({
  id: `chat:${id}`,
  title,
  subtitle: "Chat",
  kind: "chat",
  chat: { id, name: title, sessionKey: `sk_${id}` } as never,
})

const draftTab = (): EditorTab => ({
  id: "draft:group-1",
  title: "New Chat",
  subtitle: "Chat",
  kind: "draft",
})

describe("editorGroupsReducer ADD_TAB draft eviction", () => {
  it("replaces the draft tab with the new session tab on first message", () => {
    // Start with a "+" draft tab open.
    let state = createInitialState(draftTab())
    expect(getFocusedGroup(state).tabs.map((t) => t.kind)).toEqual(["draft"])

    // Sending the first message opens the real session tab.
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("a", "hello world") })

    const group = getFocusedGroup(state)
    expect(group.tabs.some((t) => t.kind === "draft")).toBe(false)
    expect(group.tabs.map((t) => t.id)).toEqual(["chat:a"])
    expect(group.activeTabId).toBe("chat:a")
    expect(group.tabs[0].title).toBe("hello world")
  })

  it("evicts a lingering draft when re-activating an already-open session tab", () => {
    // Group already has a real chat tab AND a draft sitting alongside it.
    let state = createInitialState(chatTab("a", "Real Chat"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: draftTab() })
    // Draft is now active alongside the chat tab.
    expect(getFocusedGroup(state).tabs.map((t) => t.kind).sort()).toEqual(["chat", "draft"])

    // Re-opening the existing session tab must drop the draft, not keep both.
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("a", "Real Chat") })

    const group = getFocusedGroup(state)
    expect(group.tabs.some((t) => t.kind === "draft")).toBe(false)
    expect(group.tabs.map((t) => t.id)).toEqual(["chat:a"])
    expect(group.activeTabId).toBe("chat:a")
  })

  it("is a no-op when the session tab is already active and no draft remains", () => {
    const state = createInitialState(chatTab("a", "Real Chat"))
    const next = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("a", "Real Chat") })
    expect(next).toBe(state)
  })
})
