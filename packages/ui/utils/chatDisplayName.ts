import type { Chat } from "@/types/chat"

const RAW_ID_RE = /^(?:[0-9a-f]{8}|[0-9a-f]{12,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}|chat_[0-9a-f]{12,}|sess_[0-9a-f]{12,})$/i
export const DEFAULT_CHAT_TITLE = "New Chat"

export function isPendingChatTitle(name: string | null | undefined): boolean {
  const value = name?.trim().toLowerCase()
  return !value || value === "opening chat..." || value === "opening chat…"
}

export function normalizeChatTitle(
  name: string | null | undefined,
  fallback: string | null = DEFAULT_CHAT_TITLE,
): string | null {
  if (isPendingChatTitle(name)) return fallback
  return name!.trim()
}

export function chatTitleOrFallback(
  name: string | null | undefined,
  fallback = DEFAULT_CHAT_TITLE,
): string {
  return normalizeChatTitle(name, fallback) ?? fallback
}

export function isWeakChatName(name: string | null | undefined): boolean {
  const value = name?.trim()
  if (!value) return true
  if (value === DEFAULT_CHAT_TITLE) return true
  return RAW_ID_RE.test(value)
}

export function fallbackChatNameFromText(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return "Untitled chat"
  return clean.length <= 30 ? clean : `${clean.slice(0, 27)}...`
}

export function chatDisplayName(chat: Pick<Chat, "name" | "updatedAt">): string {
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
