import type { ActiveChat, ActiveTopic } from "@/components/sidebar"
import { isWeakChatName } from "@/utils/chatDisplayName"

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
  // Transform the focused/target group's currently-active placeholder tab
  // (the "New Chat" draft, or a stale chat tab) INTO the given session tab,
  // IN PLACE, keeping it selected. Used right after a new session is created so
  // the open "New Chat" becomes that session instead of leaving a stale tab.
  | { type: "PROMOTE_ACTIVE_TO_SESSION"; groupId?: "group-1" | "group-2"; tab: EditorTab }
  | { type: "UPDATE_TAB"; tabId: string; updates: Partial<EditorTab> }
  | { type: "REMOVE_TAB"; tabId: string }
  | { type: "SET_ACTIVE_TAB"; groupId: "group-1" | "group-2"; tabId: string }
  | { type: "SET_FOCUS"; groupId: "group-1" | "group-2" }
  | {
      type: "SPLIT_TAB"
      tabId: string
      sessionData: SessionData | null
      sourceSessionData?: SessionData | null
    }
  | {
      type: "MOVE_TAB"
      tabId: string
      sourceGroupId: "group-1" | "group-2"
      targetGroupId: "group-1" | "group-2"
      targetIndex?: number
    }
  | {
      type: "REORDER_TAB"
      groupId: "group-1" | "group-2"
      tabId: string
      targetIndex: number
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
        sessionData: tab ? sessionDataFromTab(tab) : null,
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

function sessionDataFromTab(tab: EditorTab): SessionData | null {
  if (tab.kind !== "chat" || !tab.chat?.sessionKey) return null
  return {
    chat: tab.chat,
    sessionKey: tab.chat.sessionKey,
    title: tab.title,
  }
}

export function shouldPromoteActiveTabToSession(
  activeTab: EditorTab | undefined,
  activeChat: Pick<ActiveChat, "id" | "name"> | null | undefined,
): boolean {
  if (!activeTab || !activeChat?.id) return false
  if (activeTab.kind === "draft") return true
  if (activeTab.kind !== "chat") return false

  if (activeTab.chat?.id !== activeChat.id) {
    return isWeakChatName(activeTab.title) || isWeakChatName(activeTab.chat?.name)
  }

  return isWeakChatName(activeTab.title) && !isWeakChatName(activeChat.name)
}

function insertTabAt(tabs: EditorTab[], tab: EditorTab, targetIndex?: number): EditorTab[] {
  const next = [...tabs]
  const index = Math.max(0, Math.min(targetIndex ?? next.length, next.length))
  next.splice(index, 0, tab)
  return next
}

export function editorGroupsReducer(
  state: EditorGroupsState,
  action: EditorGroupsAction,
): EditorGroupsState {
  switch (action.type) {
    case "ADD_TAB": {
      const targetId = action.groupId ?? state.focusedGroupId
      let changed = false
      const groups = state.groups.map((g) => {
        if (g.id !== targetId) return g
        const existing = g.tabs.findIndex(
          (t) => t.id === action.tab.id,
        )
        const withoutDraft = g.tabs.filter(
          (t) => t.kind !== "draft",
        )
        let nextGroup: EditorGroup
        if (action.tab.kind === "draft") {
          nextGroup = {
            ...g,
            tabs: [...withoutDraft, action.tab],
            activeTabId: action.tab.id,
            sessionData: null,
          }
        } else if (existing >= 0) {
          const nextTab = action.tab
          const currentTab = g.tabs[existing]
          if (
            currentTab?.kind === nextTab.kind &&
            currentTab.title === nextTab.title &&
            currentTab.subtitle === nextTab.subtitle &&
            (currentTab.kind !== "chat" || nextTab.kind !== "chat" || currentTab.chat?.sessionKey === nextTab.chat?.sessionKey) &&
            (currentTab.kind !== "topic" || nextTab.kind !== "topic" || currentTab.topic?.id === nextTab.topic?.id)
          ) {
            const currentSessionData = sessionDataFromTab(currentTab) ?? g.sessionData
            const sameSessionData =
              (!currentSessionData && !g.sessionData) ||
              (Boolean(currentSessionData && g.sessionData) &&
                currentSessionData?.chat.id === g.sessionData?.chat.id &&
                currentSessionData?.sessionKey === g.sessionData?.sessionKey &&
                currentSessionData?.title === g.sessionData?.title)
            if (g.activeTabId === action.tab.id && sameSessionData) return g
            nextGroup = {
              ...g,
              activeTabId: action.tab.id,
              sessionData: currentSessionData,
            }
          } else {
            nextGroup = {
              ...g,
              tabs: withoutDraft.map((t) =>
                t.id === action.tab.id ? nextTab : t,
              ),
              activeTabId: action.tab.id,
              sessionData: sessionDataFromTab(nextTab) ?? g.sessionData,
            }
          }
        } else {
          nextGroup = {
            ...g,
            tabs: [...withoutDraft, action.tab],
            activeTabId: action.tab.id,
            sessionData: sessionDataFromTab(action.tab) ?? g.sessionData,
          }
        }
        changed = true
        return nextGroup
      })
      return changed ? { ...state, groups } : state
    }

    case "PROMOTE_ACTIVE_TO_SESSION": {
      const targetId = action.groupId ?? state.focusedGroupId
      let changed = false
      const groups = state.groups.map((g) => {
        if (g.id !== targetId) return g
        const activeIdx = g.tabs.findIndex((t) => t.id === g.activeTabId)
        if (activeIdx < 0) return g
        // If the active tab is ALREADY this session (same id + same title +
        // same session), nothing to do.
        const current = g.tabs[activeIdx]
        if (
          current.id === action.tab.id &&
          current.title === action.tab.title &&
          current.kind === action.tab.kind &&
          current.chat?.sessionKey === action.tab.chat?.sessionKey
        ) {
          return g
        }
        // Overwrite the active tab in place with the session tab, and drop any
        // OTHER copy of this session tab elsewhere in the group (so promotion
        // never produces a duplicate). Keep the promoted tab selected.
        const tabs = g.tabs
          .map((t, i) => (i === activeIdx ? action.tab : t))
          .filter((t, i) => i === activeIdx || t.id !== action.tab.id)
        changed = true
        return {
          ...g,
          tabs,
          activeTabId: action.tab.id,
          sessionData: sessionDataFromTab(action.tab) ?? g.sessionData,
        }
      })
      return changed ? { ...state, groups } : state
    }

    case "UPDATE_TAB": {
      let changed = false
      const groups = state.groups.map((g) => {
        let groupChanged = false
        let updatedActiveTab: EditorTab | null = null
        const tabs = g.tabs.map((t) => {
          if (t.id !== action.tabId) return t
          const updated = { ...t, ...action.updates }
          if (g.activeTabId === action.tabId) updatedActiveTab = updated
          groupChanged = true
          changed = true
          return updated
        })
        if (!groupChanged) return g
        if (!updatedActiveTab) return { ...g, tabs }
        const updatedSessionData = sessionDataFromTab(updatedActiveTab) ?? g.sessionData
        return {
          ...g,
          tabs,
          sessionData: updatedSessionData,
        }
      })
      return changed ? { ...state, groups } : state
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
      const source = state.groups.find((group) =>
        group.tabs.some((t) => t.id === action.tabId),
      )
      const tab = source?.tabs.find((t) => t.id === action.tabId)
      if (!source || !tab) return state

      const remainingTabs = source.tabs.filter(
        (t) => t.id !== action.tabId,
      )
      const nextActive =
        remainingTabs[remainingTabs.length - 1]?.id ?? null
      const updatedSource = ensureGroupHasTabs({
        ...source,
        tabs: remainingTabs,
        activeTabId: nextActive,
        sessionData: action.sourceSessionData ?? null,
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
          tabs: insertTabAt(targetGroup.tabs, tab, action.targetIndex),
          activeTabId: tab.id,
        }
        return {
          groups: [updatedTarget],
          focusedGroupId: updatedTarget.id,
        }
      }

      const updatedTarget = {
        ...targetGroup,
        tabs: insertTabAt(targetGroup.tabs, tab, action.targetIndex),
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

    case "REORDER_TAB": {
      return {
        ...state,
        groups: state.groups.map((g) => {
          if (g.id !== action.groupId) return g
          const tab = g.tabs.find((t) => t.id === action.tabId)
          if (!tab) return g
          const withoutTab = g.tabs.filter((t) => t.id !== action.tabId)
          return {
            ...g,
            tabs: insertTabAt(withoutTab, tab, action.targetIndex),
          }
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
