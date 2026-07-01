import type { ChatMessage } from "../components/ChatView/types"
import { isStandaloneChatErrorText } from "./chatErrorText"
import { cleanUserMessageText } from "./chatHistoryParser"

// Fuzzy optimistic/live-vs-final dedup only collides among rows from the same
// (recent) turn, so we only scan this many trailing rows instead of the whole
// history. Keeps dedup O(N) on long chats. Generous enough to span a turn's
// user + optimistic echo + live + final rows and any interleaved tool rows.
const FUZZY_DEDUP_WINDOW = 32

const ATTACHMENT_PLACEHOLDER_RE =
  /(?:^|\n)\s*\[Attached [^:\]]+: [^\]]+\]\s*/g
const EMBEDDED_ATTACHED_FILE_RE = /(?:<attached-file\b[^>]*>[\s\S]*?(?:<\/attached-file>|$)|&lt;attached-file\b[\s\S]*?(?:&lt;\/attached-file&gt;|$))\s*/gi

function normalizedUserText(value: string | undefined | null) {
  if (!value || typeof value !== "string") return ""
  return cleanUserMessageText(value)
    .replace(ATTACHMENT_PLACEHOLDER_RE, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function normalizeUserTextForDedupe(text: string | undefined | null) {
  if (!text || typeof text !== "string") return ""
  return cleanUserMessageText(text)
    .replace(/^\s*\[Attached images?:[^\]]+\]\s*/gim, "")
    .replace(/^\s*\[media attached:[\s\S]*?\]\s*/gim, "")
    .replace(/\s+/g, " ")
    .trim()
}

function cleanUserDisplayText(text: string | undefined | null) {
  if (!text || typeof text !== "string") return ""
  if (!EMBEDDED_ATTACHED_FILE_RE.test(text)) return text.trim()
  EMBEDDED_ATTACHED_FILE_RE.lastIndex = 0
  return cleanUserMessageText(text).trim()
}

function hasSameAttachments(a: ChatMessage, b: ChatMessage) {
  const aNames = (a.attachments ?? []).map((item) => item.name).sort().join("|")
  const bNames = (b.attachments ?? []).map((item) => item.name).sort().join("|")
  return aNames === bNames
}

function isImageAttachment(attachment: NonNullable<ChatMessage["attachments"]>[number]) {
  return attachment.mimeType?.toLowerCase().startsWith("image/") ?? false
}

function mergeAttachments(
  existing: ChatMessage["attachments"],
  incoming: ChatMessage["attachments"],
): ChatMessage["attachments"] {
  if (!incoming?.length) return existing
  if (!existing?.length) return incoming

  const unmatchedExisting = [...existing]
  const merged = incoming.map((attachment) => {
    const matchIndex = unmatchedExisting.findIndex((candidate) =>
      (candidate.name === attachment.name && candidate.mimeType === attachment.mimeType) ||
      (Boolean(candidate.url) && candidate.url === attachment.url) ||
      (existing.length === 1 && incoming.length === 1 && isImageAttachment(candidate) && isImageAttachment(attachment))
    )
    if (matchIndex < 0) return attachment
    const match = unmatchedExisting.splice(matchIndex, 1)[0]
    return {
      ...match,
      ...attachment,
      // Optimistic rows usually retain the original local filename/content;
      // canonical Gateway rows usually retain the authenticated media URL.
      // Combine both instead of replacing the useful optimistic preview with a
      // generated media id filename.
      name: match.name || attachment.name,
      content: match.content ?? attachment.content,
      url: attachment.url ?? match.url,
      size: attachment.size ?? match.size,
      mimeType: attachment.mimeType ?? match.mimeType,
    }
  })

  return [...merged, ...unmatchedExisting]
}

function stripNoReplyLines(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "NO_REPLY")
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

export function collapseRepeatedAssistantText(value: string | undefined | null) {
  if (!value || typeof value !== "string") return ""
  let text = stripNoReplyLines(value)
  while (text.length > 0 && text.length % 2 === 0) {
    const half = text.length / 2
    const left = text.slice(0, half)
    if (left !== text.slice(half)) break
    text = left
  }
  return text
}

export function mergeAssistantText(existing: string, incoming: string) {
  const a = collapseRepeatedAssistantText(existing)
  const b = collapseRepeatedAssistantText(incoming)
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
    const current = merged.get(tool.id)
    const terminalCurrent = current?.status === "success" || current?.status === "error"
    const staleRunningIncoming = terminalCurrent && tool.status === "running"
    // Skip duplicate tool calls that are already in terminal state
    if (terminalCurrent && staleRunningIncoming) {
      continue
    }
    merged.set(tool.id, staleRunningIncoming
      ? { ...tool, ...current }
      : { ...(current ?? {}), ...tool }
    )
  }
  return Array.from(merged.values())
}

function hasOverlappingToolCalls(a: ChatMessage, b: ChatMessage) {
  const aIds = new Set((a.toolCalls ?? []).map((tool) => tool.id))
  return (b.toolCalls ?? []).some((tool) => aIds.has(tool.id))
}

function hasOverlappingToolOnlyCalls(a: ChatMessage, b: ChatMessage) {
  if (collapseRepeatedAssistantText(a.text) || collapseRepeatedAssistantText(b.text)) return false
  if (!a.toolCalls?.length || !b.toolCalls?.length) return false
  return hasOverlappingToolCalls(a, b)
}

function hasDifferentGatewayIndex(a: ChatMessage, b: ChatMessage) {
  const aIndex = a.gatewayIndex
  const bIndex = b.gatewayIndex
  return (
    typeof aIndex === "number" &&
    Number.isFinite(aIndex) &&
    aIndex > 0 &&
    typeof bIndex === "number" &&
    Number.isFinite(bIndex) &&
    bIndex > 0 &&
    aIndex !== bIndex
  )
}

function hasSameGatewayIndex(a: ChatMessage, b: ChatMessage) {
  return (
    typeof a.gatewayIndex === "number" &&
    Number.isFinite(a.gatewayIndex) &&
    a.gatewayIndex > 0 &&
    typeof b.gatewayIndex === "number" &&
    Number.isFinite(b.gatewayIndex) &&
    b.gatewayIndex > 0 &&
    a.gatewayIndex === b.gatewayIndex
  )
}

function hasSameRunId(a: ChatMessage, b: ChatMessage) {
  return Boolean(a.runId && b.runId && a.runId === b.runId)
}

function isAssistantErrorLike(message: ChatMessage) {
  if (message.role !== "assistant") return false
  if (isStandaloneChatErrorText(message.text)) return true
  return message.stopReason === "error" && !message.text.trim()
}

function isOptimisticUserCandidate(message: ChatMessage) {
  return Boolean(message.isOptimistic || message.sendStatus)
}

function hasUserAttachments(message: ChatMessage) {
  return Boolean(message.attachments?.length)
}

function parsedMessageTime(message: ChatMessage) {
  if (!message.createdAt) return null
  const parsed = Date.parse(message.createdAt)
  return Number.isFinite(parsed) ? parsed : null
}

function sameOptimisticUserTurn(a: ChatMessage, b: ChatMessage) {
  const aOptimistic = isOptimisticUserCandidate(a)
  const bOptimistic = isOptimisticUserCandidate(b)

  // Two different optimistic rows can be the user intentionally sending the
  // exact same text twice. Only collapse them if they are literally the same
  // client row; otherwise the second send appears hidden until Gateway echoes.
  if (aOptimistic && bOptimistic) return Boolean(a.messageId && a.messageId === b.messageId)
  if (!aOptimistic && !bOptimistic) return false

  const optimisticWasAlreadyVisible = aOptimistic && !bOptimistic
  const optimistic = aOptimistic ? a : b
  const canonical = aOptimistic ? b : a
  const optimisticTime = parsedMessageTime(optimistic)
  const canonicalTime = parsedMessageTime(canonical)

  // A canonical echo normally arrives at/after the optimistic send. In the
  // desktop app the canonical timestamp can be produced by Gateway/middleware
  // while the optimistic timestamp is browser-local, so small clock/ordering
  // skew used to leave both rows visible as duplicate user messages. Keep the
  // guard against intentionally repeated messages, but allow a bounded reverse
  // skew for the same optimistic turn.
  if (optimisticTime !== null && canonicalTime !== null) {
    const hasAttachmentEcho = Boolean(
      optimistic.attachments?.length ||
      canonical.attachments?.length ||
      ATTACHMENT_PLACEHOLDER_RE.test(optimistic.text) ||
      ATTACHMENT_PLACEHOLDER_RE.test(canonical.text)
    )
    ATTACHMENT_PLACEHOLDER_RE.lastIndex = 0
    const maxForwardMs = hasAttachmentEcho ? 5 * 60 * 1000 : 5 * 60 * 1000
    const maxReverseSkewMs = hasAttachmentEcho ? 5 * 60 * 1000 : 30 * 1000
    const delta = canonicalTime - optimisticTime
    if (delta < 0) {
      const samePositiveGatewayIndex = hasSameGatewayIndex(optimistic, canonical)
      const canonicalHasGatewayIndex = typeof canonical.gatewayIndex === "number" && Number.isFinite(canonical.gatewayIndex) && canonical.gatewayIndex > 0
      return (hasAttachmentEcho || samePositiveGatewayIndex || optimisticWasAlreadyVisible || !canonicalHasGatewayIndex) && Math.abs(delta) <= maxReverseSkewMs
    }
    return delta <= maxForwardMs
  }

  // Without ordering metadata, text-only optimistic matching is too broad for
  // repeated messages. Keep both visible rather than hiding a real second send.
  return false
}

function sameAttachmentUserEcho(a: ChatMessage, b: ChatMessage, aText: string, bText: string) {
  if (!aText || aText !== bText) return false
  if (hasUserAttachments(a) === hasUserAttachments(b)) return false
  const aTime = parsedMessageTime(a)
  const bTime = parsedMessageTime(b)
  if (aTime !== null && bTime !== null && Math.abs(aTime - bTime) > 5 * 60 * 1000) return false
  return true
}

export function sameUserMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "user" || b.role !== "user") return false
  const aText = normalizeUserTextForDedupe(a.text)
  const bText = normalizeUserTextForDedupe(b.text)
  if (hasSameGatewayIndex(a, b)) return true
  if (hasSameRunId(a, b) && aText && aText === bText) return true
  if (sameAttachmentUserEcho(a, b, aText, bText)) return true
  const hasOptimisticCandidate = isOptimisticUserCandidate(a) || isOptimisticUserCandidate(b)
  // Optimistic client rows can carry synthetic/local gateway indexes that drift
  // from the canonical Gateway echo (especially image sends restored through
  // bootstrap/warm cache). Do not let the index mismatch short-circuit the
  // stronger optimistic-turn check below; otherwise the duplicate is detected
  // diagnostically but remains visible as a second user bubble.
  if (hasDifferentGatewayIndex(a, b) && !hasOptimisticCandidate) return false
  if (a.messageId && b.messageId && a.messageId === b.messageId) return true

  if (!hasOptimisticCandidate && !isSyntheticMessageId(a.messageId) && !isSyntheticMessageId(b.messageId)) return false

  if (!aText || aText !== bText) return false
  if (!hasSameAttachments(a, b) && !hasOptimisticCandidate) return false
  if (hasOptimisticCandidate) return sameOptimisticUserTurn(a, b)
  if (a.createdAt && b.createdAt) {
    if (a.createdAt === b.createdAt) return true
    const aTime = Date.parse(a.createdAt)
    const bTime = Date.parse(b.createdAt)
    if (Number.isFinite(aTime) && Number.isFinite(bTime)) {
      return Math.abs(aTime - bTime) <= 5 * 60 * 1000
    }
    return false
  }
  return false
}

function isAssistantPrefixUpdate(shorter: string, longer: string) {
  if (!longer.startsWith(shorter)) return false
  const nextChar = longer.charAt(shorter.length)
  // Streaming updates extend at token/word boundaries. Do not collapse distinct
  // numbered messages such as "assistant 8" and "assistant 80".
  return nextChar === "" || /[\s.,!?;:)'"`\]}]/.test(nextChar)
}

export function isLiveAssistantEcho(message: ChatMessage) {
  return message.role === "assistant" && /^live:.+:assistant$/.test(message.messageId ?? "")
}

function isGatewayInjectedCommandReply(message: ChatMessage) {
  return message.role === "assistant" && message.model === "gateway-injected"
}

function sameAssistantMessage(a: ChatMessage, b: ChatMessage) {
  if (a.role !== "assistant" || b.role !== "assistant") return false
  const aText = collapseRepeatedAssistantText(a.text)
  const bText = collapseRepeatedAssistantText(b.text)

  // Running the same slash command twice (e.g. /status then /status) produces
  // two byte-identical gateway-injected replies. They are DISTINCT command
  // results, not a streaming echo of one another (echoes are `live:*:assistant`
  // rows or share a runId — both handled below). During the live stream the
  // second reply has no gatewayIndex yet, so without this guard it falls
  // through to the identical-text branch and gets merged into the first,
  // leaving the repeated command stuck on "Writing…" with no answer. Model
  // turns are never gateway-injected, so this never affects live streaming.
  if (
    isGatewayInjectedCommandReply(a) &&
    isGatewayInjectedCommandReply(b) &&
    a.messageId &&
    b.messageId &&
    a.messageId !== b.messageId
  ) {
    return false
  }

  // A persisted websocket/live assistant row can arrive after the canonical
  // Gateway final message with a synthetic local seq/gatewayIndex. Treat exact
  // live echoes as the same assistant turn even when those synthetic indexes
  // drift, otherwise rapid tab/reload flows show the final answer twice.
  if ((isLiveAssistantEcho(a) || isLiveAssistantEcho(b)) && aText && aText === bText) return true
  if (hasSameRunId(a, b) && aText && bText) return true

  // Tool-only assistant rows are often replay/update projections for the same
  // underlying tool call. Collapse those by tool id even when live/backfill
  // sequence numbers drift, but keep text-bearing assistant replies protected
  // by gatewayIndex so distinct answers do not merge solely because a backend
  // accidentally reused a tool id.
  if (hasOverlappingToolOnlyCalls(a, b)) return true
  if (hasDifferentGatewayIndex(a, b)) return false
  if (isAssistantErrorLike(a) && isAssistantErrorLike(b)) {
    return a.messageId === b.messageId || hasSameGatewayIndex(a, b)
  }
  if (a.messageId === b.messageId) return true
  if (hasOverlappingToolCalls(a, b)) return true
  if (!aText || !bText) return false
  if (aText === bText) return true

  if ((a.text.includes("NO_REPLY") || b.text.includes("NO_REPLY")) && (
    aText.length <= bText.length
      ? isAssistantPrefixUpdate(aText, bText)
      : isAssistantPrefixUpdate(bText, aText)
  )) {
    return true
  }

  const shorterText = aText.length <= bText.length ? aText : bText
  const longerText = aText.length <= bText.length ? bText : aText
  if (!/\s/.test(shorterText) && isAssistantPrefixUpdate(shorterText, longerText)) {
    return true
  }

  // Only collapse prefix-style assistant updates when the backend says both
  // records are the same transcript slot. Forked/restored histories can contain
  // many assistant replies whose text starts similarly ("There it is...",
  // "I fixed..."). Merging those by text prefix makes newer replies replace or
  // append into earlier answers, which is exactly what fork chats were doing
  // after bootstrap/reconcile.
  if (!hasSameGatewayIndex(a, b)) return false
  return aText.length <= bText.length
    ? isAssistantPrefixUpdate(aText, bText)
    : isAssistantPrefixUpdate(bText, aText)
}

function messageSignature(message: ChatMessage) {
  const rawText = typeof message.text === "string" ? message.text : ""
  const text = message.role === "user"
    ? normalizedUserText(rawText)
    : collapseRepeatedAssistantText(rawText).replace(/\s+/g, " ")
  return `${message.role}:${text}`
}

function isSyntheticMessageId(messageId: string | null | undefined) {
  return !messageId || messageId.startsWith("msg-") || messageId.startsWith("openclaw:")
}

function canTextCollapseRepeatedMessages(a: ChatMessage, b: ChatMessage) {
  if (a.messageId && b.messageId && a.messageId === b.messageId) return true
  if (a.messageId && b.messageId && (
    a.messageId === `${b.messageId}-duplicate` ||
    b.messageId === `${a.messageId}-duplicate`
  )) return true
  if (!isSyntheticMessageId(a.messageId) && !isSyntheticMessageId(b.messageId)) return false
  return hasSameGatewayIndex(a, b)
}

function collapseRepeatedBlocks(messages: ChatMessage[]) {
  const result = [...messages]
  // Perf: messageSignature() allocates (collapseRepeatedAssistantText + regex).
  // Computing it inside the O(N²) block scan made dedup quadratic-with-a-big-
  // constant and janked streaming on long chats. Compute each signature once
  // and compare by index; keep the sig array in lockstep with splices.
  const sigs = result.map(messageSignature)
  let changed = true

  while (changed) {
    changed = false
    for (let size = Math.floor(result.length / 2); size >= 2; size--) {
      for (let start = 0; start + size * 2 <= result.length; start++) {
        let same = true
        for (let offset = 0; offset < size; offset++) {
          if (
            sigs[start + offset] !== sigs[start + size + offset] ||
            !canTextCollapseRepeatedMessages(result[start + offset], result[start + size + offset])
          ) {
            same = false
            break
          }
        }
        if (same) {
          result.splice(start + size, size)
          sigs.splice(start + size, size)
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
  // Perf: precompute signatures once (see collapseRepeatedBlocks) instead of
  // re-deriving them O(N²) times inside the block scan.
  const sigs = roleItems.map((item) => messageSignature(item.message))

  for (let size = Math.floor(roleItems.length / 2); size >= 2; size--) {
    for (let start = 0; start + size * 2 <= roleItems.length; start++) {
      let same = true
      for (let offset = 0; offset < size; offset++) {
        if (
          sigs[start + offset] !== sigs[start + size + offset] ||
          !canTextCollapseRepeatedMessages(roleItems[start + offset].message, roleItems[start + size + offset].message)
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

function messageTimeMs(message: ChatMessage) {
  if (!message.createdAt) return undefined
  const parsed = Date.parse(message.createdAt)
  return Number.isFinite(parsed) ? parsed : undefined
}

function roleOrder(message: ChatMessage) {
  return message.role === "user" ? 0 : 1
}

export function sortChatMessagesByTimeline(messages: ChatMessage[]): ChatMessage[] {
  const sorted = messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const aIndex = a.message.gatewayIndex
      const bIndex = b.message.gatewayIndex
      const aHasIndex = typeof aIndex === "number" && Number.isFinite(aIndex) && aIndex > 0
      const bHasIndex = typeof bIndex === "number" && Number.isFinite(bIndex) && bIndex > 0

      // 1. Both rows carry the backend's monotonic gateway seq — authoritative.
      //    Within the same seq, the user turn sorts before the assistant reply.
      if (aHasIndex && bHasIndex) {
        if (aIndex !== bIndex) return aIndex - bIndex
        if (a.message.role !== b.message.role) return roleOrder(a.message) - roleOrder(b.message)
        return a.index - b.index
      }

      // 2. Otherwise at least one row is optimistic/live (no seq yet — a streamed
      //    answer only acquires a seq on reload). Order by wall-clock time:
      //    client send time for the just-sent message, server/model time for a
      //    streaming or sequenced answer. This keeps every reply pinned under the
      //    user turn it belongs to instead of floating to a stale array slot —
      //    the multi-turn ordering bug where a new send pushed an older, still-
      //    unsequenced answer below it. Same-turn ties keep the user first.
      const aTime = messageTimeMs(a.message)
      const bTime = messageTimeMs(b.message)
      if (typeof aTime === "number" && typeof bTime === "number") {
        // Guard against sub-second clock skew inverting a turn: if the two rows
        // belong to the same run, force user-before-assistant regardless of time.
        if (hasSameRunId(a.message, b.message) && a.message.role !== b.message.role) {
          return roleOrder(a.message) - roleOrder(b.message)
        }
        if (aTime !== bTime) return aTime - bTime
        if (a.message.role !== b.message.role) return roleOrder(a.message) - roleOrder(b.message)
        return a.index - b.index
      }

      // 3. No comparable seq or time (e.g. restored legacy history without
      //    metadata) — preserve array/arrival order.
      return a.index - b.index
    })
    .map((item) => item.message)
  return sorted
}

export function dedupeChatMessages(messages: ChatMessage[]): ChatMessage[] {
  // Normalize message.text to a string at the dedup entry point so every
  // downstream helper (.trim/.includes/.replace/regex .test) is safe even if
  // upstream feeds us a message whose text is undefined/null (can happen for
  // chunk-fetched rows whose .data payload is incomplete, evicted+restreamed
  // rows, or partial WS patches arriving before the text frame).
  const normalizedInput = messages.map((m) => {
    if (typeof m.text !== "string") return { ...m, text: "" }
    if (m.role !== "user") return m
    const cleanedText = cleanUserDisplayText(m.text)
    return cleanedText === m.text ? m : { ...m, text: cleanedText }
  })
  const result: ChatMessage[] = []
  const seenIds = new Set<string>()
  // Perf: dedup used to scan the entire growing `result` for every input
  // message (exact-id + two fuzzy passes), which is O(N²). On a long chat this
  // re-ran on every streaming token and janked rendering (~50ms/delta at 100
  // msgs, ~280ms at 300). Exact-id matches go through a Map (O(1)), and the
  // fuzzy optimistic/live-vs-final dedup only ever collides among RECENT rows
  // (same turn), so we bound those scans to a trailing window. Net O(N).
  const idToIndex = new Map<string, number>()
  let lastUserResultIndex = -1

  for (const originalMessage of collapseRepeatedBlocks(normalizedInput)) {
    const message = originalMessage.role === "assistant"
      ? { ...originalMessage, text: collapseRepeatedAssistantText(originalMessage.text) }
      : originalMessage
    const sameIdIndex = idToIndex.has(message.messageId)
      ? (idToIndex.get(message.messageId) as number)
      : -1
    // Two identical gateway-injected command replies (e.g. /status run twice
    // back-to-back) can derive the SAME content-based messageId when upstream
    // gives no stable id/seq (messageId() falls back to role+createdAt+text, and
    // identical command output => identical text). When a USER turn separates the
    // existing match from this new reply, they are DISTINCT command runs, not a
    // backfill re-projection of one row — collapsing them by id drops the second
    // answer and leaves the repeated command stuck on "Writing…". Re-projections
    // of the SAME turn (no user turn in between) still collapse normally, and the
    // fuzzy pass below already never merges across a user boundary.
    const repeatedCommandAcrossUserTurn =
      sameIdIndex >= 0 &&
      isGatewayInjectedCommandReply(message) &&
      isGatewayInjectedCommandReply(result[sameIdIndex]) &&
      sameIdIndex < lastUserResultIndex
    if (sameIdIndex >= 0 && !repeatedCommandAcrossUserTurn) {
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
        toolCalls: mergeToolCalls(existing.toolCalls, message.toolCalls),
        attachments: mergeAttachments(existing.attachments, message.attachments),
      }
      seenIds.add(message.messageId)
      continue
    }

    const lastUserIndex = message.role === "assistant" && !isLiveAssistantEcho(message)
      ? lastUserResultIndex
      : -1
    const assistantScanStart = Math.max(lastUserIndex + 1, result.length - FUZZY_DEDUP_WINDOW, 0)
    let assistantIndex = -1
    for (let index = assistantScanStart; index < result.length; index++) {
      if (index > lastUserIndex && sameAssistantMessage(result[index], message)) {
        assistantIndex = index
        break
      }
    }
    if (assistantIndex >= 0) {
      const existing = result[assistantIndex]
      const preferred = isLiveAssistantEcho(existing) && !isLiveAssistantEcho(message)
        ? message
        : isLiveAssistantEcho(message) && !isLiveAssistantEcho(existing)
          ? existing
          : message.text.trim().length >= existing.text.trim().length
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
        attachments: mergeAttachments(existing.attachments, preferred.attachments),
      }
      idToIndex.set(message.messageId, assistantIndex)
      idToIndex.set(result[assistantIndex].messageId, assistantIndex)
      seenIds.add(message.messageId)
      continue
    }

    const userScanStart = Math.max(result.length - FUZZY_DEDUP_WINDOW, 0)
    let duplicateUserIndex = -1
    for (let index = userScanStart; index < result.length; index++) {
      if (sameUserMessage(result[index], message)) {
        duplicateUserIndex = index
        break
      }
    }
    if (duplicateUserIndex >= 0) {
      const existing = result[duplicateUserIndex]
      const preferIncoming =
        Boolean(existing.isOptimistic && !message.isOptimistic) ||
        Boolean(existing.sendStatus && !message.sendStatus)
      const preferAttachmentRow = hasUserAttachments(message) && !hasUserAttachments(existing)
        ? true
        : hasUserAttachments(existing) && !hasUserAttachments(message)
          ? false
          : preferIncoming
      const preferred = preferAttachmentRow ? message : existing
      const fallback = preferAttachmentRow ? existing : message
      result[duplicateUserIndex] = {
        ...fallback,
        ...preferred,
        messageId: preferred.messageId,
        optimisticMessageId:
          fallback.optimisticMessageId ??
          preferred.optimisticMessageId ??
          (isOptimisticUserCandidate(fallback) ? fallback.messageId : undefined),
        text: cleanUserDisplayText(preferred.text) || cleanUserDisplayText(fallback.text) || preferred.text || fallback.text,
        createdAt: fallback.createdAt || preferred.createdAt,
        attachments: mergeAttachments(fallback.attachments, preferred.attachments),
        replyTo: preferred.replyTo ?? fallback.replyTo,
        isOptimistic: preferIncoming ? false : preferred.isOptimistic,
        sendStatus: preferIncoming ? undefined : preferred.sendStatus,
        sendError: preferIncoming ? null : preferred.sendError,
      }
      idToIndex.set(message.messageId, duplicateUserIndex)
      idToIndex.set(result[duplicateUserIndex].messageId, duplicateUserIndex)
      seenIds.add(message.messageId)
      continue
    }

    seenIds.add(message.messageId)
    idToIndex.set(message.messageId, result.length)
    if (message.role === "user") lastUserResultIndex = result.length
    result.push(message)
  }

  return sortChatMessagesByTimeline(collapseRepeatedBlocks(collapseRepeatedRoleBlocks(result, "user")))
}
