import { describe, expect, it } from "vitest"
import { createInitialState, editorGroupsReducer, getFocusedGroup, type EditorTab } from "./editorGroups"

const chatTab = (id: string, sessionKey: string, title = "Chat"): EditorTab => ({
  id: `chat:${id}`,
  title,
  subtitle: "Chat",
  kind: "chat",
  chat: { id, name: title, sessionKey } as never,
})

const draftTab = (): EditorTab => ({
  id: "draft:group-1",
  title: "New Chat",
  subtitle: "Chat",
  kind: "draft",
})

describe("editorGroupsReducer ADD_TAB — new chat / session identity", () => {
  it("replaces the New Chat draft with the new session tab on first message", () => {
    let state = createInitialState(draftTab())
    expect(getFocusedGroup(state).tabs.map((t) => t.kind)).toEqual(["draft"])

    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("a", "sk_a", "hello world") })

    const group = getFocusedGroup(state)
    expect(group.tabs.some((t) => t.kind === "draft")).toBe(false)
    expect(group.tabs.map((t) => t.id)).toEqual(["chat:a"])
    expect(group.activeTabId).toBe("chat:a")
    expect(group.tabs[0].title).toBe("hello world")
  })

  it("migrates an optimistic tab to the server id (same sessionKey) without duplicating", () => {
    // Optimistic quick-send tab under a client-generated id.
    let state = createInitialState(chatTab("client_123", "sk_shared", "hello"))
    expect(getFocusedGroup(state).tabs.map((t) => t.id)).toEqual(["chat:client_123"])

    // Server returned a different chat id; reconcile re-adds under that id with
    // the SAME sessionKey. Must replace the optimistic tab in place, not add a 2nd.
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("server_999", "sk_shared", "hello") })

    const group = getFocusedGroup(state)
    expect(group.tabs.map((t) => t.id)).toEqual(["chat:server_999"])
    expect(group.activeTabId).toBe("chat:server_999")
  })

  it("does not open a duplicate when re-selecting the same session under a different id", () => {
    // chat already open under server id.
    let state = createInitialState(chatTab("server_999", "sk_shared", "Real Chat"))
    // Sidebar click for the same session but (hypothetically) stale id.
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("stale_1", "sk_shared", "Real Chat") })

    const group = getFocusedGroup(state)
    expect(group.tabs.length).toBe(1)
    expect(group.tabs[0].chat?.sessionKey).toBe("sk_shared")
  })

  it("opens a separate tab for a genuinely different session", () => {
    let state = createInitialState(chatTab("a", "sk_a", "First"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("b", "sk_b", "Second") })

    const group = getFocusedGroup(state)
    expect(group.tabs.map((t) => t.id).sort()).toEqual(["chat:a", "chat:b"])
    expect(group.activeTabId).toBe("chat:b")
  })

  it("is a no-op when the exact same tab is re-added and already active", () => {
    const state = createInitialState(chatTab("a", "sk_a", "Chat"))
    const next = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("a", "sk_a", "Chat") })
    expect(next).toBe(state)
  })
})
