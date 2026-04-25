import type { ChatMessage } from "@/components/ChatView/types"

export type MessageReaction = "up" | "down"

export type MessageActionState = {
  pinnedIds: string[]
  deletedIds: string[]
  reactions: Record<string, MessageReaction>
  replyToId: string | null
  selectedQuote: string | null
}

export type MessageAction =
  | { type: "pin"; messageId: string }
  | { type: "unpin"; messageId: string }
  | { type: "delete"; messageId: string }
  | { type: "react"; messageId: string; reaction: MessageReaction }
  | { type: "reply"; messageId: string }
  | { type: "quote"; text: string }
  | { type: "clear_reply" }

export const initialMessageActionState: MessageActionState = {
  pinnedIds: [],
  deletedIds: [],
  reactions: {},
  replyToId: null,
  selectedQuote: null,
}

export function messageActionReducer(
  state: MessageActionState,
  action: MessageAction,
): MessageActionState {
  if (action.type === "pin") {
    return state.pinnedIds.includes(action.messageId)
      ? state
      : { ...state, pinnedIds: [...state.pinnedIds, action.messageId] }
  }
  if (action.type === "unpin") {
    return {
      ...state,
      pinnedIds: state.pinnedIds.filter((id) => id !== action.messageId),
    }
  }
  if (action.type === "delete") {
    return {
      ...state,
      deletedIds: state.deletedIds.includes(action.messageId)
        ? state.deletedIds
        : [...state.deletedIds, action.messageId],
      pinnedIds: state.pinnedIds.filter((id) => id !== action.messageId),
    }
  }
  if (action.type === "react") {
    return {
      ...state,
      reactions: { ...state.reactions, [action.messageId]: action.reaction },
    }
  }
  if (action.type === "reply") {
    return { ...state, replyToId: action.messageId, selectedQuote: null }
  }
  if (action.type === "quote") {
    return { ...state, selectedQuote: action.text, replyToId: null }
  }
  return { ...state, replyToId: null, selectedQuote: null }
}

export function visibleMessages(
  messages: ChatMessage[],
  state: MessageActionState,
): ChatMessage[] {
  const deleted = new Set(state.deletedIds)
  return messages.filter((message) => !deleted.has(message.messageId))
}

export function pinnedMessages(
  messages: ChatMessage[],
  state: MessageActionState,
): ChatMessage[] {
  const byId = new Map(messages.map((message) => [message.messageId, message]))
  return state.pinnedIds
    .map((id) => byId.get(id))
    .filter((message): message is ChatMessage => Boolean(message))
}

export function quotePrefix(text: string): string {
  return text
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")
}

export function exportMessagesMarkdown(messages: ChatMessage[]): string {
  return messages
    .map((message) => {
      const speaker = message.role === "user" ? "User" : "Assistant"
      return `## ${speaker}\n\n${message.text.trim()}`
    })
    .join("\n\n")
    .trim()
}
