import type { ChatMessage, ContentBlock } from "./types"
import { isStandaloneChatErrorText } from "@/lib/chatErrorText"

export function extractText(content?: unknown): string {
  if (!content) return ""
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (!b || typeof b !== "object") return ""
        const block = b as ContentBlock & { content?: unknown; output?: unknown }
        const value = block.text ?? block.content ?? block.output
        if (typeof value === "string") return value
        if (value !== undefined && value !== null) {
          try {
            return JSON.stringify(value, null, 2)
          } catch {
            return String(value)
          }
        }
        return ""
      })
      .filter(Boolean)
      .join("")
  }
  if (typeof content === "object") {
    const value = content as { text?: unknown; content?: unknown; output?: unknown; result?: unknown }
    const direct = value.text ?? value.content ?? value.output ?? value.result
    if (typeof direct === "string") return direct
    if (direct != null && direct !== content) return extractText(direct)
  }
  return ""
}

export function isAssistantErrorMessage(
  message: Pick<ChatMessage, "role" | "stopReason" | "text">
): boolean {
  if (message.role !== "assistant") return false
  if (isStandaloneChatErrorText(message.text)) return true
  return message.stopReason === "error" && !message.text.trim()
}

export function formatAssistantErrorText(text: string): string {
  const trimmed = text.trim()
  const quotedPayload = trimmed.match(/^(.*?\S)\s+("(?:\\.|[^"\\])*")$/)
  if (!quotedPayload) return trimmed

  try {
    const parsed = JSON.parse(quotedPayload[2]) as unknown
    if (typeof parsed === "string" && parsed.trim()) {
      return `${quotedPayload[1]} ${parsed.trim()}`
    }
  } catch {
    return trimmed
  }

  return trimmed
}
