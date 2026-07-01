import { describe, expect, it } from "vitest"
import { deriveEditorGroupsTabTitles } from "./editorTabDisplay"
import type { EditorGroupsState } from "./editorGroups"

function state(): EditorGroupsState {
  return {
    focusedGroupId: "group-1",
    groups: [
      {
        id: "group-1",
        activeTabId: "chat:chat-1",
        sessionData: null,
        tabs: [
          { id: "chat:chat-1", title: "New Chat", subtitle: "Chat", kind: "chat", chat: { id: "chat-1", name: "New Chat" } },
          { id: "topic:project-1:topic-1", title: "Topic One", subtitle: "Project", kind: "topic", topic: { id: "topic-1", name: "Topic One", projectId: "project-1", projectName: "Project" } },
          { id: "draft:group-1", title: "New Chat", subtitle: "Chat", kind: "draft" },
        ],
      },
    ],
  }
}

describe("editor tab display titles", () => {
  it("derives chat tab labels from the live chat record", () => {
    const displayState = deriveEditorGroupsTabTitles(
      state(),
      new Map([["chat-1", { name: "A useful session name" }]]),
    )

    expect(displayState.groups[0]?.tabs[0]?.title).toBe("A useful session name")
    expect(displayState.groups[0]?.tabs[1]?.title).toBe("Topic One")
    expect(displayState.groups[0]?.tabs[2]?.title).toBe("New Chat")
  })

  it("prefers the active chat name so first-message autonames update immediately", () => {
    const displayState = deriveEditorGroupsTabTitles(
      state(),
      new Map(),
      { id: "chat-1", name: "Freshly autonamed" },
    )

    expect(displayState.groups[0]?.tabs[0]?.title).toBe("Freshly autonamed")
  })

  it("lets a live generated title override a weak active chat name", () => {
    const displayState = deriveEditorGroupsTabTitles(
      state(),
      new Map([["chat-1", { name: "Generated title" }]]),
      { id: "chat-1", name: "New Chat" },
    )

    expect(displayState.groups[0]?.tabs[0]?.title).toBe("Generated title")
  })

  it("treats the live chat-list name as authoritative over a stale active name", () => {
    // The live title map mirrors the server-backed sidebar list, so a rename
    // landing there must win over a stale active-chat snapshot. Otherwise
    // renaming the currently-open chat updates the sidebar but the header tab
    // keeps the old active name.
    const displayState = deriveEditorGroupsTabTitles(
      state(),
      new Map([["chat-1", { name: "Renamed in sidebar" }]]),
      { id: "chat-1", name: "Stale active name" },
    )

    expect(displayState.groups[0]?.tabs[0]?.title).toBe("Renamed in sidebar")
  })

  it("falls back to the active chat name when the live list has no entry yet", () => {
    const displayState = deriveEditorGroupsTabTitles(
      state(),
      new Map(),
      { id: "chat-1", name: "Brand new name" },
    )

    expect(displayState.groups[0]?.tabs[0]?.title).toBe("Brand new name")
  })

  it("honors an already-synced tab title over a still-weak active chat name", () => {
    const base = state()
    // The send/autoname flow updated the tab title, but the active chat name
    // is still the weak placeholder. The header must show the resolved tab
    // title, not fall back to "New Chat".
    base.groups[0]!.tabs[0] = {
      id: "chat:chat-1",
      title: "hello",
      subtitle: "Chat",
      kind: "chat",
      chat: { id: "chat-1", name: "New Chat" },
    }

    const displayState = deriveEditorGroupsTabTitles(
      base,
      new Map(),
      { id: "chat-1", name: "New Chat" },
    )

    expect(displayState.groups[0]?.tabs[0]?.title).toBe("hello")
  })

  it("keeps the placeholder while every source is still weak", () => {
    const displayState = deriveEditorGroupsTabTitles(
      state(),
      new Map(),
      { id: "chat-1", name: "Opening chat..." },
    )

    expect(displayState.groups[0]?.tabs[0]?.title).toBe("New Chat")
  })
})
