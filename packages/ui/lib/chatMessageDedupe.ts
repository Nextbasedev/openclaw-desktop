import type { ChatMessage } from "../components/ChatView/types"
import { cleanUserMessageText } from "./chatHistoryParser"

const ATTACHMENT_PLACEHOLDER_RE =
  /(?:^|\n)\s*\[Attached [^:\]]+: [^\]]+\]\s*/g

function normalizedUserText(value: string) {
  return cleanUserMessageText(value)
    .replace(ATTACHMENT_PLACEHOLDER_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function sameUserMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  if (normalizedUserText(a.text) !== normalizedUserText(b.text)) return false
  if (
    typeof a.gatewayIndex === "number" &&
    typeof b.gatewayIndex === "number" &&
    a.gatewayIndex === b.gatewayIndex
  ) {
    return true
  }
  if (a.createdAt && b.createdAt) {
    if (a.createdAt === b.createdAt) return true
    if (a.isOptimistic || b.isOptimistic) {
      const aTime = Date.parse(a.createdAt)
      const bTime = Date.parse(b.createdAt)
      if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
        return Math.abs(aTime - bTime) <= 5 * 60 * 1000
      }
    }
    return false
  }
  return Boolean(a.isOptimistic || b.isOptimistic)
}

function isAssistantPrefixUpdate(shorter: string, longer: string) {
  if (!longer.startsWith(shorter)) return false
  const nextChar = longer.charAt(shorter.length)
  // Streaming updates extend at token/word boundaries. Do not collapse distinct
  // numbered messages such as "assistant 8" and "assistant 80".
  return nextChar === "" || /[\s.,!?;:)'"`\]}]/.test(nextChar)
}

export function sameAssistantMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "assistant" || b.role !== "assistant") return false
  const aText = a.text.trim()
  const bText = b.text.trim()
  if (!aText || !bText) return false
  if (a.messageId === b.messageId) return true
  if (aText === bText) return true
  return aText.length <= bText.length
    ? isAssistantPrefixUpdate(aText, bText)
    : isAssistantPrefixUpdate(bText, aText)
}

function messageSignature(message: ChatMessage) {
  const text = message.role === "user"
    ? normalizedUserText(message.text)
    : message.text.trim().replace(/\s+/g, " ")
  return `${message.role}:${text}`
}

function collapseRepeatedBlocks(messages: ChatMessage[]) {
  const result = [...messages]
  let changed = true

  while (changed) {
    changed = false
    for (let size = Math.floor(result.length / 2); size >= 2; size--) {
      for (let start = 0; start + size * 2 <= result.length; start++) {
        let same = true
        for (let offset = 0; offset < size; offset++) {
          if (
            messageSignature(result[start + offset]) !==
            messageSignature(result[start + size + offset])
          ) {
            same = false
            break
          }
        }
        if (same) {
          result.splice(start + size, size)
          changed = true
          break
        }
      }
      if (changed) break
    }
  }

  return result
}

function collapseRepeatedRoleBlocks(
  messages: ChatMessage[],
  role: ChatMessage["role"]
) {
  const roleItems = messages
    .map((message, index) => ({ message, index }))
    .filter((item) => item.message.role === role)
  const duplicateIndexes = new Set<number>()

  for (let size = Math.floor(roleItems.length / 2); size >= 2; size--) {
    for (let start = 0; start + size * 2 <= roleItems.length; start++) {
      let same = true
      for (let offset = 0; offset < size; offset++) {
        if (
          messageSignature(roleItems[start + offset].message) !==
          messageSignature(roleItems[start + size + offset].message)
        ) {
          same = false
          break
        }
      }
      if (!same) continue
      for (let offset = 0; offset < size; offset++) {
        duplicateIndexes.add(roleItems[start + size + offset].index)
      }
    }
  }

  return duplicateIndexes.size > 0
    ? messages.filter((_, index) => !duplicateIndexes.has(index))
    : messages
}

export function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = []
  const seenIds = new Set<string>()

  for (const message of collapseRepeatedBlocks(messages)) {
    const sameIdIndex = result.findIndex(
      (existing) => existing.messageId === message.messageId
    )
    if (sameIdIndex >= 0) {
      const existing = result[sameIdIndex]
      result[sameIdIndex] = {
        ...existing,
        ...message,
        text:
          message.text.trim().length >= existing.text.trim().length
            ? message.text
            : existing.text,
        createdAt: existing.createdAt || message.createdAt,
        embeds: message.embeds ?? existing.embeds,
        usage: message.usage ?? existing.usage,
        stopReason: message.stopReason ?? existing.stopReason,
        model: message.model ?? existing.model,
        toolCalls: message.toolCalls ?? existing.toolCalls,
        attachments: message.attachments ?? existing.attachments,
      }
      seenIds.add(message.messageId)
      continue
    }

    const assistantIndex = result.findIndex((existing) =>
      sameAssistantMessage(existing, message)
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
        createdAt: existing.createdAt || preferred.createdAt,
        embeds: preferred.embeds ?? existing.embeds,
        usage: preferred.usage ?? existing.usage,
        stopReason: preferred.stopReason ?? existing.stopReason,
        model: preferred.model ?? existing.model,
        attachments: preferred.attachments ?? existing.attachments,
      }
      seenIds.add(message.messageId)
      continue
    }

    const duplicateUserIndex = result.findIndex((existing) =>
      sameUserMessage(existing, message)
    )
    if (duplicateUserIndex >= 0) {
      const existing = result[duplicateUserIndex]
      const preferIncoming =
        Boolean(existing.isOptimistic && !message.isOptimistic) ||
        Boolean(existing.sendStatus && !message.sendStatus)
      const preferred = preferIncoming ? message : existing
      const fallback = preferIncoming ? existing : message
      result[duplicateUserIndex] = {
        ...fallback,
        ...preferred,
        messageId: preferred.messageId,
        text: preferred.text.trim() ? preferred.text : fallback.text,
        createdAt: fallback.createdAt || preferred.createdAt,
        attachments: preferred.attachments ?? fallback.attachments,
        replyTo: preferred.replyTo ?? fallback.replyTo,
        isOptimistic: preferIncoming ? false : preferred.isOptimistic,
        sendStatus: preferIncoming ? undefined : preferred.sendStatus,
        sendError: preferIncoming ? null : preferred.sendError,
      }
      seenIds.add(message.messageId)
      continue
    }

    seenIds.add(message.messageId)
    result.push(message)
  }

  return collapseRepeatedBlocks(collapseRepeatedRoleBlocks(result, "user"))
}
