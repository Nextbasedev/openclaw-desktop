import type { ChatMessage, StreamStatus } from "../../components/ChatView/types"
import { cleanUserMessageText, parseChatHistory } from "../chatHistoryParser"
import { dedupeChatMessages } from "../chatMessageDedupe"
import type { PatchFrame, PatchPayloadV2 } from "./types"

type ApplyPatchState = {
  cursor: number
  messages: ChatMessage[]
}

function patchPayload(frame: PatchFrame): PatchPayloadV2 | null {
  const payload = frame.patch.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  return payload as PatchPayloadV2
}

function isMessagePatchType(type: string) {
  return type === "chat.message.upsert" ||
    type === "chat.message.confirmed" ||
    type === "chat.user.created" ||
    type === "chat.user.confirmed" ||
    type === "chat.assistant.started" ||
    type === "chat.assistant.delta" ||
    type === "chat.assistant.final"
}

function patchSemanticType(frame: PatchFrame): string {
  const semanticType = patchPayload(frame)?.semanticType
  return typeof semanticType === "string" && semanticType.trim() ? semanticType : frame.patch.type
}

function patchMessage(frame: PatchFrame): unknown | null {
  if (!isMessagePatchType(frame.patch.type) && !isMessagePatchType(patchSemanticType(frame))) return null
  return patchPayload(frame)?.message ?? null
}

function patchOptimisticId(frame: PatchFrame): string | null {
  const type = patchSemanticType(frame)
  if (frame.patch.type !== "chat.message.confirmed" && type !== "chat.user.confirmed") return null
  const payload = patchPayload(frame)
  const id = payload?.optimisticId ?? payload?.clientMessageId ?? payload?.messageId
  return typeof id === "string" && id.trim() ? id : null
}

function patchMessageSeq(frame: PatchFrame): number | undefined {
  const payload = patchPayload(frame)
  const payloadSeq = payload?.messageSeq ?? payload?.gatewayIndex
  if (typeof payloadSeq === "number" && Number.isFinite(payloadSeq)) return Math.floor(payloadSeq)
  const message = patchMessage(frame)
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const openclaw = (message as { __openclaw?: { seq?: unknown } }).__openclaw
    const seq = openclaw?.seq
    if (typeof seq === "number" && Number.isFinite(seq)) return Math.floor(seq)
  }
  return undefined
}

function patchRunId(frame: PatchFrame): string | null {
  const payload = patchPayload(frame)
  const payloadRunId = payload?.runId
  if (typeof payloadRunId === "string" && payloadRunId.trim()) return payloadRunId.trim()
  const message = patchMessage(frame)
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const raw = message as { runId?: unknown; __openclaw?: { runId?: unknown } }
    const runId = raw.__openclaw?.runId ?? raw.runId
    if (typeof runId === "string" && runId.trim()) return runId.trim()
  }
  return null
}

function inferAssistantSeqFromRun(state: ApplyPatchState, frame: PatchFrame, parsed: ChatMessage[], messageSeq: number | undefined): number | undefined {
  if (!parsed.some((item) => item.role === "assistant")) return messageSeq
  const runId = patchRunId(frame)
  if (!runId) return messageSeq
  const matchingUser = [...state.messages]
    .reverse()
    .find((item) => item.role === "user" && item.runId === runId && typeof item.gatewayIndex === "number" && Number.isFinite(item.gatewayIndex))
  if (!matchingUser || typeof matchingUser.gatewayIndex !== "number") return messageSeq
  // During live streaming the backend can stamp an assistant/tool message with a
  // raw gateway messageSeq that is LOWER than the user message that triggered
  // the run (the live and history-backfill seq sources disagree until backfill
  // rewrites the canonical seq). Trusting that value makes the tool card render
  // ABOVE the user message for a moment, then snap back once history catches up.
  // Anchor the assistant after its own run's user message so it never jumps up.
  const floor = matchingUser.gatewayIndex + 1
  if (typeof messageSeq !== "number") return floor
  return Math.max(messageSeq, floor)
}

function shouldAnimateAssistantTextPatch(frame: PatchFrame, message: ChatMessage): boolean {
  if (message.role !== "assistant") return false
  if (!message.text.trim()) return false
  const semanticType = patchSemanticType(frame)
  if (semanticType.startsWith("chat.assistant.")) return true
  if (frame.patch.type.startsWith("chat.assistant.")) return true
  const status = statusFromPatch(frame)?.status
  return Boolean(status && ACTIVE_STATUSES.has(status))
}

function patchRemoveId(frame: PatchFrame): string | null {
  if (frame.patch.type !== "chat.message.remove") return null
  const id = patchPayload(frame)?.messageId
  return typeof id === "string" && id.trim() ? id : null
}

function normalizedUserText(value: string): string {
  return cleanUserMessageText(value).replace(/\s+/g, " ").trim()
}

function userTextMatchesSent(candidateText: string, sentText: string): boolean {
  const candidate = normalizedUserText(candidateText)
  const sent = normalizedUserText(sentText)
  if (!candidate || !sent) return false
  return candidate === sent || candidate.endsWith(` ${sent}`)
}

function rejectsStaleConfirmedUser(state: ApplyPatchState, optimisticId: string | null, normalized: ChatMessage[]): boolean {
  if (!optimisticId) return false
  const confirmed = normalized.find((item) => item.role === "user")
  if (!confirmed) return false
  const existing = state.messages.find((item) => item.messageId === optimisticId)
  if (!existing || existing.role !== "user") return false
  return !userTextMatchesSent(confirmed.text, existing.text)
}

function matchingUserIdsAtGatewayIndex(state: ApplyPatchState, normalized: ChatMessage[], messageSeq: number | undefined): string[] {
  if (typeof messageSeq !== "number") return []
  const incomingUser = normalized.find((item) => item.role === "user")
  if (!incomingUser) return []
  return state.messages
    .filter((item) =>
      item.role === "user" &&
      item.gatewayIndex === messageSeq &&
      item.messageId !== incomingUser.messageId &&
      userTextMatchesSent(item.text, incomingUser.text)
    )
    .map((item) => item.messageId)
}

function matchingOptimisticUserIdsByText(state: ApplyPatchState, normalized: ChatMessage[], messageSeq: number | undefined): string[] {
  const incomingUser = normalized.find((item) => item.role === "user" && !item.isOptimistic)
  if (!incomingUser?.text.trim()) return []
  const match = state.messages.find((item) =>
    item.role === "user" &&
    item.isOptimistic &&
    (typeof messageSeq !== "number" || typeof item.gatewayIndex !== "number" || item.gatewayIndex <= 0) &&
    item.messageId !== incomingUser.messageId &&
    userTextMatchesSent(incomingUser.text, item.text)
  )
  return match ? [match.messageId] : []
}

function isToolOnlyAssistantMessage(message: ChatMessage) {
  return message.role === "assistant" && !message.text.trim() && Boolean(message.toolCalls?.length)
}

function latestAssistantIndexAfterLastUser(messages: ChatMessage[]) {
  let latestUserIndex = -1
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      latestUserIndex = i
      break
    }
  }
  for (let i = messages.length - 1; i > latestUserIndex; i--) {
    if (messages[i]?.role === "assistant") return i
  }
  return -1
}

function canMergeToolOnlyAssistantIntoLatest(messages: ChatMessage[], index: number, incoming: ChatMessage, activePatch: boolean) {
  const target = messages[index]
  if (!target || target.role !== "assistant") return false
  // Existing live behavior: while the run is explicitly active, keep folding
  // tool-only projections into the current assistant card even if text has
  // already started streaming.
  if (activePatch) return true

  // Some live message.upsert projections for assistant tool calls arrive
  // without runStatus/activeRun, so the old active-only guard appended one
  // tool-only assistant row per tool. Refresh was correct because the history
  // parser merges adjacent assistant tool rows. Mirror that live, but keep the
  // fallback narrow: only merge adjacent tool-only assistant rows in the same
  // visible assistant turn, and do not fold tools into a text-bearing answer
  // unless the patch explicitly says the run is active (handled above).
  if (!isToolOnlyAssistantMessage(target)) return false
  if (target.runId && incoming.runId && target.runId !== incoming.runId) return false
  return true
}

function mergeInlineToolCalls(existing: ChatMessage["toolCalls"], incoming: NonNullable<ChatMessage["toolCalls"]>) {
  const merged = new Map((existing ?? []).map((tool) => [tool.id, tool]))
  for (const tool of incoming) {
    const current = merged.get(tool.id)
    const terminalCurrent = current?.status === "success" || current?.status === "error"
    const staleRunningIncoming = terminalCurrent && tool.status === "running"
    // Skip duplicate tool calls that are already in terminal state
    if (terminalCurrent && staleRunningIncoming) {
      continue
    }
    merged.set(tool.id, current ? {
      ...current,
      ...(staleRunningIncoming ? {} : tool),
      duration: tool.duration ?? current.duration,
      startedAt: tool.startedAt ?? current.startedAt,
      completedAt: tool.completedAt ?? current.completedAt,
      resultText: tool.resultText ?? current.resultText,
      approval: tool.approval ?? current.approval,
    } : tool)
  }
  return Array.from(merged.values())
}

function mergeToolOnlyAssistantMessages(baseMessages: ChatMessage[], incoming: ChatMessage[], frame: PatchFrame) {
  const patchStatus = statusFromPatch(frame)?.status
  const canMergeLiveToolMessages = Boolean(patchStatus && ACTIVE_STATUSES.has(patchStatus))
  const messages = [...baseMessages]
  for (const message of incoming) {
    if (!isToolOnlyAssistantMessage(message) || !message.toolCalls?.length) {
      messages.push(message)
      continue
    }
    const index = latestAssistantIndexAfterLastUser(messages)
    if (index < 0) {
      messages.push(message)
      continue
    }
    if (!canMergeToolOnlyAssistantIntoLatest(messages, index, message, canMergeLiveToolMessages)) {
      messages.push(message)
      continue
    }
    const target = messages[index]
    messages[index] = {
      ...target,
      toolCalls: mergeInlineToolCalls(target.toolCalls, message.toolCalls),
      createdAt: target.createdAt ?? message.createdAt,
      gatewayIndex: target.gatewayIndex ?? message.gatewayIndex,
    }
  }
  return messages
}

function messageHasAttachments(message: ChatMessage) {
  return Boolean(message.attachments?.length)
}

type MessageAttachment = NonNullable<ChatMessage["attachments"]>[number]

function attachmentHasPreview(attachment: MessageAttachment) {
  return Boolean(attachment.content || attachment.url)
}

function isImageAttachment(attachment: MessageAttachment) {
  return attachment.mimeType?.toLowerCase().startsWith("image/") ?? false
}

function mergeUserAttachments(
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
    const name = match.content && !attachment.content
      ? match.name
      : attachment.content && !match.content
        ? attachment.name
        : match.name || attachment.name
    return {
      ...match,
      ...attachment,
      name,
      content: match.content ?? attachment.content,
      url: attachment.url ?? match.url,
      size: attachment.size ?? match.size,
      mimeType: attachment.mimeType ?? match.mimeType,
    }
  })

  return [...merged, ...unmatchedExisting]
}

function attachmentsNeedPreviewHydration(message: ChatMessage) {
  return Boolean(message.attachments?.length && message.attachments.some((attachment) => !attachmentHasPreview(attachment)))
}

function preserveUserAttachmentsFromReplacedMessages(
  state: ApplyPatchState,
  incoming: ChatMessage[],
  idsToReplace: Set<string>,
) {
  return incoming.map((message) => {
    if (message.role !== "user") return message
    const existing = state.messages.find(
      (candidate) =>
        candidate.role === "user" &&
        messageHasAttachments(candidate) &&
        (idsToReplace.has(candidate.messageId) ||
          userTextMatchesSent(message.text, candidate.text))
    )
    if (!existing?.attachments?.length) return message
    if (!messageHasAttachments(message)) return { ...message, attachments: existing.attachments }
    if (!attachmentsNeedPreviewHydration(message)) return message
    return { ...message, attachments: mergeUserAttachments(existing.attachments, message.attachments) }
  })
}

function preserveOptimisticUserDisplayFromBlankConfirmation(
  state: ApplyPatchState,
  incoming: ChatMessage[],
  optimisticId: string | null,
) {
  if (!optimisticId) return incoming
  const existing = state.messages.find((item) => item.messageId === optimisticId)
  if (!existing || existing.role !== "user" || !existing.text.trim()) return incoming
  return incoming.map((message) => {
    if (message.role !== "user" || message.text.trim()) return message
    return {
      ...message,
      text: existing.text,
      attachments: message.attachments?.length ? message.attachments : existing.attachments,
    }
  })
}

function liveAssistantIdForFinal(payload: PatchPayloadV2 | null, incoming: ChatMessage[]) {
  const runId = typeof payload?.runId === "string" && payload.runId.trim() ? payload.runId : null
  if (!runId) return null
  const hasFinalAssistant = incoming.some((message) =>
    message.role === "assistant" &&
    message.text.trim() &&
    message.messageId !== `live:${runId}:assistant`
  )
  return hasFinalAssistant ? `live:${runId}:assistant` : null
}

function hasAssistantText(messages: ChatMessage[]) {
  return messages.some((message) => message.role === "assistant" && message.text.trim())
}

function hasExistingLiveAssistantTextForRun(state: ApplyPatchState, runId: string | null) {
  if (!runId) return false
  return state.messages.some((message) =>
    message.role === "assistant" &&
    message.runId === runId &&
    message.text.trim()
  )
}


function assistantToolSourceForFinal(state: ApplyPatchState, runId: string | null, incoming: ChatMessage[]) {
  if (!hasAssistantText(incoming)) return null
  if (runId) {
    const byRun = state.messages.find((message) =>
      message.role === "assistant" &&
      message.runId === runId &&
      Boolean(message.toolCalls?.length)
    )
    if (byRun) return byRun
  }

  // Production middleware can emit tool calls as a tool-only assistant, then
  // stream text into a live assistant, then replace that live row with a final
  // canonical assistant. Transfer the accumulated tools into the final row so
  // the visible transcript stays one assistant card per turn.
  const lastUserIndex = state.messages.map((message) => message.role).lastIndexOf("user")
  for (let i = state.messages.length - 1; i > lastUserIndex; i--) {
    const message = state.messages[i]
    if (message?.role === "assistant" && Boolean(message.toolCalls?.length)) {
      return message
    }
  }
  return null
}

function mergeIncomingAssistantWithPriorTools(incoming: ChatMessage[], prior: ChatMessage | null) {
  if (!prior?.toolCalls?.length) return incoming
  return incoming.map((message) => {
    if (message.role !== "assistant" || !message.text.trim()) return message
    return {
      ...message,
      toolCalls: mergeInlineToolCalls(prior.toolCalls, message.toolCalls ?? []),
      reasoningText: message.reasoningText ?? prior.reasoningText,
    }
  })
}

function synthesizeBlankUserConfirmation(
  state: ApplyPatchState,
  parsed: ChatMessage[],
  optimisticId: string | null,
  canonicalMessageId: string | null,
  messageSeq: number | undefined,
) {
  if (parsed.length > 0 || !optimisticId) return parsed
  const existing = state.messages.find((item) => item.messageId === optimisticId)
  if (!existing || existing.role !== "user" || !existing.text.trim()) return parsed
  return [{
    ...existing,
    messageId: canonicalMessageId ?? optimisticId,
    gatewayIndex: messageSeq ?? existing.gatewayIndex,
    isOptimistic: false,
    sendStatus: undefined,
    sendError: null,
  }]
}

const ACTIVE_STATUSES = new Set<StreamStatus>(["queued", "running", "collect", "thinking", "tool_running", "streaming", "stopping", "restarting"])
const VALID_STATUSES = new Set<StreamStatus>(["idle", "connected", "queued", "running", "collect", "thinking", "tool_running", "streaming", "stopping", "restarting", "done", "error"])

function normalizePatchStatus(value: unknown): StreamStatus | null {
  if (value === "aborted") return "idle"
  if (typeof value !== "string" || !VALID_STATUSES.has(value as StreamStatus)) return null
  return value as StreamStatus
}

export function statusFromPatch(frame: PatchFrame): { status: StreamStatus; label: string | null } | null {
  const payload = patchPayload(frame)
  const semanticType = patchSemanticType(frame)
  const isStatusPatch = frame.patch.type === "chat.status" || frame.patch.type === "session.status" || frame.patch.type === "session.upsert"
  const activeRun = payload?.activeRun
  const hasActiveRun = Boolean(activeRun && typeof activeRun === "object" && !Array.isArray(activeRun))
  const hasCanonicalStatus = typeof payload?.runStatus === "string" || hasActiveRun || semanticType.startsWith("chat.run.")
  if (!isStatusPatch && !hasCanonicalStatus) return null
  const status = normalizePatchStatus(payload?.runStatus ?? payload?.status)
  if (!status) return null
  // Non-status message patches may carry projection defaults like runStatus:"idle"
  // when they are plain Gateway echoes with no active/final run. Do not let
  // those clear an actually active Thinking/Streaming UI state.
  if (!isStatusPatch && !hasActiveRun && !semanticType.startsWith("chat.run.") && !semanticType.startsWith("chat.tool.") && status !== "done" && status !== "error") return null
  if (!isStatusPatch && !hasActiveRun && status === "idle") return null
  const label = payload?.statusLabel ?? payload?.label ?? null
  return { status, label: typeof label === "string" ? label : null }
}

export function patchImpliesActiveRun(frame: PatchFrame): boolean {
  const status = statusFromPatch(frame)
  if (status) return ACTIVE_STATUSES.has(status.status)
  if (!isMessagePatchType(frame.patch.type) && !isMessagePatchType(patchSemanticType(frame))) return false
  const payload = patchPayload(frame)
  const message = patchMessage(frame)
  if (!message || typeof message !== "object" || Array.isArray(message)) return false
  const role = (message as { role?: unknown }).role
  return role === "user" && Boolean(payload?.optimistic)
}

export function applyChatPatch(state: ApplyPatchState, frame: PatchFrame): ApplyPatchState {
  if (frame.patch.cursor <= state.cursor) return state
  const removeId = patchRemoveId(frame)
  if (removeId) {
    return {
      cursor: frame.patch.cursor,
      messages: state.messages.filter((message) => message.messageId !== removeId),
    }
  }
  const message = patchMessage(frame)
  if (!message) return { ...state, cursor: frame.patch.cursor }
  const optimisticId = patchOptimisticId(frame)
  const payload = patchPayload(frame)
  const canonicalMessageId = typeof payload?.messageId === "string" && payload.messageId.trim() ? payload.messageId : optimisticId
  const initialMessageSeq = patchMessageSeq(frame)
  const parsed = synthesizeBlankUserConfirmation(
    state,
    parseChatHistory([message]).messages,
    optimisticId,
    canonicalMessageId,
    initialMessageSeq,
  )
  const messageSeq = inferAssistantSeqFromRun(state, frame, parsed, initialMessageSeq)
  const withSeq = typeof messageSeq === "number"
    ? parsed.map((item) => ({ ...item, gatewayIndex: messageSeq, runId: item.runId ?? patchRunId(frame) ?? undefined }))
    : parsed.map((item) => ({ ...item, runId: item.runId ?? patchRunId(frame) ?? undefined }))
  const normalizedRaw = canonicalMessageId
    ? withSeq.map((item) =>
      item.role === "user"
        ? { ...item, messageId: canonicalMessageId, isOptimistic: false, sendStatus: undefined, sendError: null }
        : withSeq.length === 1
          ? { ...item, messageId: canonicalMessageId }
          : item
    )
    : withSeq
  const normalized = preserveOptimisticUserDisplayFromBlankConfirmation(state, normalizedRaw, optimisticId)
  const runId = patchRunId(frame)
  if (
    patchSemanticType(frame) === "chat.assistant.final" &&
    !hasAssistantText(normalized) &&
    hasExistingLiveAssistantTextForRun(state, runId)
  ) {
    return { ...state, cursor: frame.patch.cursor }
  }
  const priorToolSourceAssistant = assistantToolSourceForFinal(state, runId, normalized)
  const normalizedWithPriorTools = mergeIncomingAssistantWithPriorTools(normalized, priorToolSourceAssistant)
  if (rejectsStaleConfirmedUser(state, optimisticId, normalizedWithPriorTools)) {
    return { ...state, cursor: frame.patch.cursor }
  }
  const normalizedHasUser = normalizedWithPriorTools.some((item) => item.role === "user")
  const liveAssistantId = liveAssistantIdForFinal(payload, normalizedWithPriorTools)
  const idsToReplace = new Set([
    optimisticId,
    normalizedHasUser ? canonicalMessageId : null,
    liveAssistantId,
    priorToolSourceAssistant?.messageId ?? null,
    ...matchingUserIdsAtGatewayIndex(state, normalizedWithPriorTools, messageSeq),
    ...matchingOptimisticUserIdsByText(state, normalizedWithPriorTools, messageSeq),
  ].filter((id): id is string => Boolean(id)))
  const baseMessages = idsToReplace.size > 0
    ? state.messages.filter((item) => !idsToReplace.has(item.messageId))
    : state.messages
  const withPreservedAttachments = preserveUserAttachmentsFromReplacedMessages(
    state,
    normalizedWithPriorTools,
    idsToReplace,
  )
  const animated = withPreservedAttachments.map((item) =>
    shouldAnimateAssistantTextPatch(frame, item)
      ? { ...item, animateText: true }
      : item
  )
  return {
    cursor: frame.patch.cursor,
    messages: dedupeChatMessages(mergeToolOnlyAssistantMessages(baseMessages, animated, frame)),
  }
}
