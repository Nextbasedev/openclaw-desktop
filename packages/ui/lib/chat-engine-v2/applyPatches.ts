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

const ACTIVE_STATUSES = new Set<StreamStatus>(["queued", "running", "collect", "thinking", "tool_running", "streaming", "stopping", "restarting"])
const VALID_STATUSES = new Set<StreamStatus>(["idle", "connected", "queued", "running", "collect", "thinking", "tool_running", "streaming", "stopping", "restarting", "done", "error"])

function normalizePatchStatus(value: unknown): StreamStatus | null {
  if (value === "aborted") return "error"
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
  const parsed = parseChatHistory([message]).messages
  const optimisticId = patchOptimisticId(frame)
  const payload = patchPayload(frame)
  const canonicalMessageId = typeof payload?.messageId === "string" && payload.messageId.trim() ? payload.messageId : optimisticId
  const messageSeq = patchMessageSeq(frame)
  const withSeq = typeof messageSeq === "number"
    ? parsed.map((item) => ({ ...item, gatewayIndex: messageSeq }))
    : parsed
  const normalized = canonicalMessageId
    ? withSeq.map((item) =>
      item.role === "user"
        ? { ...item, messageId: canonicalMessageId, isOptimistic: false, sendStatus: undefined, sendError: null }
        : withSeq.length === 1
          ? { ...item, messageId: canonicalMessageId }
          : item
    )
    : withSeq
  if (rejectsStaleConfirmedUser(state, optimisticId, normalized)) {
    return { ...state, cursor: frame.patch.cursor }
  }
  const idsToReplace = new Set([
    optimisticId,
    canonicalMessageId,
    ...matchingUserIdsAtGatewayIndex(state, normalized, messageSeq),
  ].filter((id): id is string => Boolean(id)))
  const baseMessages = idsToReplace.size > 0
    ? state.messages.filter((item) => !idsToReplace.has(item.messageId))
    : state.messages
  return {
    cursor: frame.patch.cursor,
    messages: dedupeChatMessages([...baseMessages, ...normalized]),
  }
}
