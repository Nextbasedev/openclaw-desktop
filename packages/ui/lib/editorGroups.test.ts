import { describe, expect, it } from "vitest"
import { createInitialState, editorGroupsReducer, getFocusedGroup, shouldPromoteActiveTabToSession, type EditorTab } from "./editorGroups"

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

describe("editorGroupsReducer PROMOTE_ACTIVE_TO_SESSION", () => {
  it("turns the selected New Chat draft into the session tab, in place, still selected", () => {
    let state = createInitialState(draftTab())
    expect(getFocusedGroup(state).tabs.map((t) => t.kind)).toEqual(["draft"])

    const sessionTab = chatTab("a", "sk_a", "who are you?")
    state = editorGroupsReducer(state, { type: "PROMOTE_ACTIVE_TO_SESSION", tab: sessionTab })

    const group = getFocusedGroup(state)
    expect(group.tabs.map((t) => t.id)).toEqual(["chat:a"])
    expect(group.activeTabId).toBe("chat:a")
    expect(group.tabs[0].title).toBe("who are you?")
    expect(group.tabs[0].kind).toBe("chat")
  })

  it("repoints a stale 'New Chat' chat tab to the created session, keeping the slot + selection", () => {
    // A leading pinned-ish chat, then the selected "New Chat" placeholder tab.
    let state = createInitialState(chatTab("hyy", "sk_hyy", "hyy"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("placeholder", "sk_ph", "New Chat") })
    expect(getFocusedGroup(state).activeTabId).toBe("chat:placeholder")

    // Session created under a different id → the selected placeholder becomes it.
    const sessionTab = chatTab("real", "sk_real", "who are you?")
    state = editorGroupsReducer(state, { type: "PROMOTE_ACTIVE_TO_SESSION", tab: sessionTab })

    const group = getFocusedGroup(state)
    expect(group.tabs.map((t) => t.id)).toEqual(["chat:hyy", "chat:real"])
    expect(group.activeTabId).toBe("chat:real")
    expect(group.tabs[1].title).toBe("who are you?")
  })

  it("never leaves a duplicate when the session tab already exists elsewhere", () => {
    let state = createInitialState(chatTab("real", "sk_real", "who are you?"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("placeholder", "sk_ph", "New Chat") })
    // selected = placeholder; chat:real also open.
    state = editorGroupsReducer(state, {
      type: "PROMOTE_ACTIVE_TO_SESSION",
      tab: chatTab("real", "sk_real", "who are you?"),
    })

    const group = getFocusedGroup(state)
    expect(group.tabs.filter((t) => t.id === "chat:real").length).toBe(1)
    expect(group.activeTabId).toBe("chat:real")
  })

  it("is a no-op when the selected tab already IS the session", () => {
    const state = createInitialState(chatTab("a", "sk_a", "who are you?"))
    const next = editorGroupsReducer(state, {
      type: "PROMOTE_ACTIVE_TO_SESSION",
      tab: chatTab("a", "sk_a", "who are you?"),
    })
    expect(next).toBe(state)
  })
})

describe("editorGroupsReducer ADD_TAB (baseline still intact)", () => {
  it("opens a separate tab for a genuinely different chat (no over-dedup)", () => {
    let state = createInitialState(chatTab("a", "sk_a", "First"))
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("b", "sk_b", "Second") })
    const group = getFocusedGroup(state)
    expect(group.tabs.map((t) => t.id).sort()).toEqual(["chat:a", "chat:b"])
    expect(group.activeTabId).toBe("chat:b")
  })

  it("removes the draft when a new chat tab is added", () => {
    let state = createInitialState(draftTab())
    state = editorGroupsReducer(state, { type: "ADD_TAB", tab: chatTab("a", "sk_a", "hi") })
    const group = getFocusedGroup(state)
    expect(group.tabs.some((t) => t.kind === "draft")).toBe(false)
    expect(group.tabs.map((t) => t.id)).toEqual(["chat:a"])
  })
})

describe("shouldPromoteActiveTabToSession", () => {
  it("does not replace an already-open real chat tab when another sidebar chat becomes active", () => {
    expect(
      shouldPromoteActiveTabToSession(
        chatTab("a", "sk_a", "First real chat"),
        { id: "b", name: "Second real chat" },
      ),
    ).toBe(false)
  })

  it("still replaces a weak New Chat placeholder with the created session", () => {
    expect(
      shouldPromoteActiveTabToSession(
        chatTab("placeholder", "sk_placeholder", "New Chat"),
        { id: "real", name: "who are you?" },
      ),
    ).toBe(true)
  })
})
