import type { ActiveChat } from "@/types/chat"
import type { EditorGroupsState, EditorTab } from "@/lib/editorGroups"
import { DEFAULT_CHAT_TITLE, isWeakChatName, normalizeChatTitle } from "@/utils/chatDisplayName"

type LiveChatRecord =
  | string
  | {
      name?: string | null
      title?: string | null
      chat?: { name?: string | null } | null
    }

export type LiveChatTitleMap = ReadonlyMap<string, LiveChatRecord>

function cleanTitle(value: string | null | undefined): string | null {
  if (!value?.trim()) return null
  return normalizeChatTitle(value, DEFAULT_CHAT_TITLE)
}

export function chatIdFromTab(tab: EditorTab): string | null {
  if (tab.kind !== "chat") return null
  if (tab.chat?.id) return tab.chat.id
  return tab.id.startsWith("chat:") ? tab.id.slice("chat:".length) : null
}

export function deriveChatTabTitle(
  tab: EditorTab,
  liveChatTitles: LiveChatTitleMap,
  activeChat?: ActiveChat | null,
): string {
  const chatId = chatIdFromTab(tab)
  if (!chatId) return tab.title

  const live = liveChatTitles.get(chatId)
  const liveTitle = typeof live === "string"
    ? cleanTitle(live)
    : cleanTitle(live?.chat?.name) ?? cleanTitle(live?.name) ?? cleanTitle(live?.title)

  if (activeChat?.id === chatId) {
    const activeTitle = cleanTitle(activeChat.name)
    if (activeTitle && !isWeakChatName(activeTitle)) return activeTitle
  }

  return liveTitle ?? cleanTitle(activeChat?.id === chatId ? activeChat.name : null) ?? tab.title
}

export function deriveEditorGroupsTabTitles(
  state: EditorGroupsState,
  liveChatTitles: LiveChatTitleMap,
  activeChat?: ActiveChat | null,
): EditorGroupsState {
  let changed = false
  const groups = state.groups.map((group) => {
    let groupChanged = false
    const tabs = group.tabs.map((tab) => {
      if (tab.kind !== "chat") return tab
      const title = deriveChatTabTitle(tab, liveChatTitles, activeChat)
      if (title === tab.title) return tab
      groupChanged = true
      return { ...tab, title }
    })
    if (!groupChanged) return group
    changed = true
    return { ...group, tabs }
  })

  return changed ? { ...state, groups } : state
}
