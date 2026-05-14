import type { ChatMessage, ContentBlock } from "./types"

export function extractText(content?: unknown): string {
  if (!content) return ""
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((b) => {
        if (!b || typeof b !== "object") return ""
        const block = b as ContentBlock & { content?: unknown; output?: unknown }
        const value = block.text ?? block.content ?? block.output
        return typeof value === "string" ? value : ""
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
  if (message.stopReason === "error") return true

  const text = message.text.trim()
  return (
    /^Error:\s+/i.test(text) ||
    /^Agent failed before reply:/i.test(text) ||
    /^OpenClaw error:/i.test(text) ||
    /^WebSocket error:/i.test(text)
  )
}
