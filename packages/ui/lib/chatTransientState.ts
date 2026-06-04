import type { ChatMessage } from "@/components/ChatView/types"

/**
 * Message text reveal is view-local state. It must never be treated as durable
 * chat history, because cached/restored messages would replay their reveal when
 * a ChatView remounts (for example after switching chats).
 */
export function stripTransientChatMessageState(message: ChatMessage): ChatMessage {
  if (message.animateText === undefined) return message
  const { animateText: _animateText, ...rest } = message
  return rest as ChatMessage
}

export function stripTransientChatMessagesState(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(stripTransientChatMessageState)
}
