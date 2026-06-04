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
})
