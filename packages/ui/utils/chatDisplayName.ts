import type { Chat } from "@/types/chat"

const RAW_ID_RE = /^(?:[0-9a-f]{8}|[0-9a-f]{12,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|chat_[0-9a-f]{12,}|sess_[0-9a-f]{12,})$/i

export function isWeakChatName(name: string | null | undefined): boolean {
  const value = name?.trim()
  if (!value) return true
  if (value === "New Chat") return true
  return RAW_ID_RE.test(value)
}

export function fallbackChatNameFromText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return "Untitled chat"
  return clean.length <= 30 ? clean : `${clean.slice(0, 27)}...`
}

export function chatDisplayName(chat: Pick<Chat, "name" | "updatedAt" | "lastMessageText">): string {
  if (chat.lastMessageText?.trim()) return fallbackChatNameFromText(chat.lastMessageText)
  if (!isWeakChatName(chat.name)) return chat.name
  if (chat.updatedAt) {
    try {
      return `Chat ${new Date(chat.updatedAt).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      })}`
    } catch {}
  }
  return "Untitled chat"
}
