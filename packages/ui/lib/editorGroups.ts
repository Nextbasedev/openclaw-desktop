import type { ActiveChat, ActiveTopic } from "@/components/sidebar"

export type EditorTab = {
  id: string
  title: string
  subtitle: string
  kind: "draft" | "chat" | "topic"
  chat?: ActiveChat
  topic?: ActiveTopic
}

export type SessionData = {
  chat: ActiveChat
  sessionKey: string
  title: string
}

export type EditorGroup = {
  id: "group-1" | "group-2"
  tabs: EditorTab[]
  activeTabId: string | null
  sessionData: SessionData | null
}

export type EditorGroupsState = {
  groups: EditorGroup[]
  focusedGroupId: "group-1" | "group-2"
}

export type EditorGroupsAction =
  | { type: "ADD_TAB"; groupId?: "group-1" | "group-2"; tab: EditorTab }
  | { type: "UPDATE_TAB"; tabId: string; updates: Partial<EditorTab> }
  | { type: "REMOVE_TAB"; tabId: string }
  | { type: "SET_ACTIVE_TAB"; groupId: "group-1" | "group-2"; tabId: string }
  | { type: "SET_FOCUS"; groupId: "group-1" | "group-2" }
  | {
      type: "SPLIT_TAB"
      tabId: string
      sessionData: SessionData | null
    }
  | {
      type: "MOVE_TAB"
      tabId: string
      sourceGroupId: "group-1" | "group-2"
      targetGroupId: "group-1" | "group-2"
    }
  | {
      type: "SET_SESSION_DATA"
      groupId: "group-1" | "group-2"
      sessionData: SessionData | null
    }
  | { type: "CLOSE_GROUP"; groupId: "group-1" | "group-2" }
  | { type: "RESTORE"; state: EditorGroupsState }
  | { type: "RESET"; tab?: EditorTab }

const DRAFT_TAB: EditorTab = {
  id: "draft",
  title: "New Chat",
  subtitle: "Chat",
  kind: "draft",
}

export function createInitialState(tab?: EditorTab): EditorGroupsState {
  return {
    groups: [
      {
        id: "group-1",
        tabs: [tab ?? DRAFT_TAB],
        activeTabId: tab?.id ?? "draft",
        sessionData: null,
      },
    ],
    focusedGroupId: "group-1",
  }
}

export function getFocusedGroup(
  state: EditorGroupsState,
): EditorGroup {
  return (
    state.groups.find((g) => g.id === state.focusedGroupId) ??
    state.groups[0]!
  )
}

export function getGroup(
  state: EditorGroupsState,
  id: "group-1" | "group-2",
): EditorGroup | undefined {
  return state.groups.find((g) => g.id === id)
}

export function findTabInGroups(
  state: EditorGroupsState,
  tabId: string,
): { group: EditorGroup; tab: EditorTab } | null {
  for (const group of state.groups) {
    const tab = group.tabs.find((t) => t.id === tabId)
    if (tab) return { group, tab }
  }
  return null
}

function ensureGroupHasTabs(group: EditorGroup): EditorGroup {
  if (group.tabs.length > 0) return group
  return {
    ...group,
    tabs: [DRAFT_TAB],
    activeTabId: "draft",
    sessionData: null,
  }
}

function removeTabFromGroup(
  group: EditorGroup,
  tabId: string,
): EditorGroup {
  const next = group.tabs.filter((t) => t.id !== tabId)
  if (group.activeTabId === tabId) {
    const fallback = next[next.length - 1]
    return {
      ...group,
      tabs: next,
      activeTabId: fallback?.id ?? null,
      sessionData: null,
    }
  }
  return { ...group, tabs: next }
}

export function editorGroupsReducer(
  state: EditorGroupsState,
  action: EditorGroupsAction,
): EditorGroupsState {
  switch (action.type) {
    case "ADD_TAB": {
      const targetId = action.groupId ?? state.focusedGroupId
      return {
        ...state,
        groups: state.groups.map((g) => {
          if (g.id !== targetId) return g
          const existing = g.tabs.findIndex(
            (t) => t.id === action.tab.id,
          )
          const withoutDraft = g.tabs.filter(
            (t) => t.kind !== "draft",
          )
          if (action.tab.kind === "draft") {
            return {
              ...g,
              tabs: [...withoutDraft, action.tab],
              activeTabId: action.tab.id,
              sessionData: null,
            }
          }
          if (existing >= 0) {
            return {
              ...g,
              tabs: withoutDraft.map((t) =>
                t.id === action.tab.id ? action.tab : t,
              ),
              activeTabId: action.tab.id,
            }
          }
          return {
            ...g,
            tabs: [...withoutDraft, action.tab],
            activeTabId: action.tab.id,
          }
        }),
      }
    }

    case "UPDATE_TAB": {
      return {
        ...state,
        groups: state.groups.map((g) => ({
          ...g,
          tabs: g.tabs.map((t) =>
            t.id === action.tabId ? { ...t, ...action.updates } : t,
          ),
        })),
      }
    }

    case "REMOVE_TAB": {
      const location = findTabInGroups(state, action.tabId)
      if (!location) return state

      const updatedGroup = removeTabFromGroup(
        location.group,
        action.tabId,
      )

      if (
        updatedGroup.tabs.length === 0 &&
        state.groups.length > 1
      ) {
        const remaining = state.groups.filter(
          (g) => g.id !== location.group.id,
        )
        return {
          groups: remaining,
          focusedGroupId: remaining[0]!.id,
        }
      }

      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === location.group.id
            ? ensureGroupHasTabs(updatedGroup)
            : g,
        ),
      }
    }

    case "SET_ACTIVE_TAB": {
      return {
        ...state,
        focusedGroupId: action.groupId,
        groups: state.groups.map((g) => {
          if (g.id !== action.groupId) return g
          const tab = g.tabs.find((t) => t.id === action.tabId)
          return {
            ...g,
            activeTabId: action.tabId,
            sessionData: tab?.kind === "draft" ? null : g.sessionData,
          }
        }),
      }
    }

    case "SET_FOCUS": {
      return { ...state, focusedGroupId: action.groupId }
    }

    case "SPLIT_TAB": {
      if (state.groups.length >= 2) return state
      const source = state.groups[0]!
      const tab = source.tabs.find((t) => t.id === action.tabId)
      if (!tab) return state

      const remainingTabs = source.tabs.filter(
        (t) => t.id !== action.tabId,
      )
      const nextActive =
        remainingTabs[remainingTabs.length - 1]?.id ?? null
      const updatedSource = ensureGroupHasTabs({
        ...source,
        tabs: remainingTabs,
        activeTabId: nextActive,
      })

      const newGroup: EditorGroup = {
        id: "group-2",
        tabs: [tab],
        activeTabId: tab.id,
        sessionData: action.sessionData,
      }

      return {
        groups: [updatedSource, newGroup],
        focusedGroupId: "group-2",
      }
    }

    case "MOVE_TAB": {
      if (action.sourceGroupId === action.targetGroupId) return state
      const sourceGroup = getGroup(state, action.sourceGroupId)
      const targetGroup = getGroup(state, action.targetGroupId)
      if (!sourceGroup || !targetGroup) return state

      const tab = sourceGroup.tabs.find(
        (t) => t.id === action.tabId,
      )
      if (!tab) return state

      const updatedSource = removeTabFromGroup(
        sourceGroup,
        action.tabId,
      )

      if (updatedSource.tabs.length === 0) {
        const updatedTarget = {
          ...targetGroup,
          tabs: [...targetGroup.tabs, tab],
          activeTabId: tab.id,
        }
        return {
          groups: [updatedTarget],
          focusedGroupId: updatedTarget.id,
        }
      }

      const updatedTarget = {
        ...targetGroup,
        tabs: [...targetGroup.tabs, tab],
        activeTabId: tab.id,
      }

      return {
        ...state,
        focusedGroupId: action.targetGroupId,
        groups: state.groups.map((g) => {
          if (g.id === action.sourceGroupId)
            return ensureGroupHasTabs(updatedSource)
          if (g.id === action.targetGroupId) return updatedTarget
          return g
        }),
      }
    }

    case "SET_SESSION_DATA": {
      return {
        ...state,
        groups: state.groups.map((g) =>
          g.id === action.groupId
            ? { ...g, sessionData: action.sessionData }
            : g,
        ),
      }
    }

    case "CLOSE_GROUP": {
      if (state.groups.length <= 1) return state
      const closing = getGroup(state, action.groupId)
      const remaining = state.groups.filter(
        (g) => g.id !== action.groupId,
      )
      if (!closing || remaining.length === 0) return state

      const target = remaining[0]!
      const mergedTabs = [
        ...target.tabs,
        ...closing.tabs.filter(
          (t) =>
            t.kind !== "draft" &&
            !target.tabs.some((tt) => tt.id === t.id),
        ),
      ]

      return {
        groups: [{ ...target, tabs: mergedTabs }],
        focusedGroupId: target.id,
      }
    }

    case "RESTORE": {
      const groups = action.state.groups
        .filter((group) => group.id === "group-1" || group.id === "group-2")
        .map((group) => ensureGroupHasTabs(group))
      if (groups.length === 0) return state
      const focusedGroupId = groups.some((group) => group.id === action.state.focusedGroupId)
        ? action.state.focusedGroupId
        : groups[0]!.id
      return { groups: groups.slice(0, 2), focusedGroupId }
    }

    case "RESET": {
      return createInitialState(action.tab)
    }

    default:
      return state
  }
}
