import type { ChatMessage } from "../components/ChatView/types"

function normalizeUserTextForDedupe(text: string) {
  return text
    .replace(/^\s*\[Attached images?:[^\]]+\]\s*/gim, "")
    .replace(/^\s*\[media attached:[\s\S]*?\]\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim()
}

function hasSameAttachments(a: ChatMessage, b: ChatMessage) {
  const aNames = (a.attachments ?? []).map((item) => item.name).sort().join("|")
  const bNames = (b.attachments ?? []).map((item) => item.name).sort().join("|")
  return aNames === bNames
}

function stripNoReplyLines(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "NO_REPLY")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function mergeAssistantText(existing: string, incoming: string) {
  const a = stripNoReplyLines(existing)
  const b = stripNoReplyLines(incoming)
  if (!a) return b
  if (!b) return a
  if (a === b) return a
  if (b.startsWith(a)) return b
  if (a.startsWith(b)) return a

  const max = Math.min(a.length, b.length)
  for (let len = max; len >= 8; len--) {
    if (a.slice(-len) === b.slice(0, len)) {
      return `${a}${b.slice(len)}`
    }
  }
  return `${a}\n\n${b}`
}

function mergeToolCalls(
  existing: ChatMessage["toolCalls"],
  incoming: ChatMessage["toolCalls"],
) {
  if (!existing?.length) return incoming
  if (!incoming?.length) return existing
  const merged = new Map(existing.map((tool) => [tool.id, tool]))
  for (const tool of incoming) {
    merged.set(tool.id, { ...(merged.get(tool.id) ?? {}), ...tool })
  }
  return Array.from(merged.values())
}

function hasOverlappingToolCalls(a: ChatMessage, b: ChatMessage) {
  const aIds = new Set((a.toolCalls ?? []).map((tool) => tool.id))
  return (b.toolCalls ?? []).some((tool) => aIds.has(tool.id))
}

export function sameUserMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  const aText = normalizeUserTextForDedupe(a.text)
  const bText = normalizeUserTextForDedupe(b.text)
  if (!aText || aText !== bText) return false
  if (!hasSameAttachments(a, b) && !a.isOptimistic && !b.isOptimistic) return false
  // When returning to a session, the optimistic local user message may have a
  // slightly different timestamp or may omit history's attachment marker text.
  // Treat it as the same message so it does not get appended after the reply.
  if (a.isOptimistic || b.isOptimistic) return true
  if (a.createdAt && b.createdAt) return a.createdAt === b.createdAt
  return false
}

export function sameAssistantMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "assistant" || b.role !== "assistant") return false
  const aText = stripNoReplyLines(a.text)
  const bText = stripNoReplyLines(b.text)
  if (a.messageId === b.messageId) return true
  if (hasOverlappingToolCalls(a, b)) return true
  if (!aText || !bText) return false
  if (aText === bText) return true
  return aText.startsWith(bText) || bText.startsWith(aText)
}

export function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  const seenIds = new Set<string>()

  for (const message of messages) {
    if (seenIds.has(message.messageId)) continue

    const assistantIndex = result.findIndex((existing) =>
      sameAssistantMessage(existing, message),
    )
    if (assistantIndex >= 0) {
      const existing = result[assistantIndex]
      const preferred =
        message.text.trim().length >= existing.text.trim().length
          ? message
          : existing
      result[assistantIndex] = {
        ...existing,
        ...preferred,
        text: mergeAssistantText(existing.text, message.text),
        createdAt: existing.createdAt || preferred.createdAt,
        embeds: preferred.embeds ?? existing.embeds,
        usage: preferred.usage ?? existing.usage,
        stopReason: preferred.stopReason ?? existing.stopReason,
        model: preferred.model ?? existing.model,
        toolCalls: mergeToolCalls(existing.toolCalls, message.toolCalls),
      }
      seenIds.add(message.messageId)
      continue
    }

    const duplicateUser = result.some((existing) =>
      sameUserMessage(existing, message),
    )
    if (duplicateUser) continue

    seenIds.add(message.messageId)
    result.push(message)
  }

  return result
}
