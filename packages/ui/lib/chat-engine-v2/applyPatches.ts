import type { ChatMessage, StreamStatus } from "../../components/ChatView/types"
import { parseChatHistory } from "../chatHistoryParser"
import { dedupeChatMessages } from "../chatMessageDedupe"
import type { PatchFrame } from "./client"

type ApplyPatchState = {
  cursor: number
  messages: ChatMessage[]
}

function patchPayload(frame: PatchFrame): Record<string, unknown> | null {
  const payload = frame.patch.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  return payload as Record<string, unknown>
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

function patchRemoveId(frame: PatchFrame): string | null {
  if (frame.patch.type !== "chat.message.remove") return null
  const id = patchPayload(frame)?.messageId
  return typeof id === "string" && id.trim() ? id : null
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
  const hasCanonicalStatus = typeof payload?.runStatus === "string" || semanticType.startsWith("chat.run.")
  if (frame.patch.type !== "chat.status" && frame.patch.type !== "session.status" && frame.patch.type !== "session.upsert" && !hasCanonicalStatus) return null
  const status = normalizePatchStatus(payload?.runStatus ?? payload?.status)
  if (!status) return null
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
  const normalized = canonicalMessageId
    ? parsed.map((item) => item.role === "user" ? { ...item, messageId: canonicalMessageId, isOptimistic: false, sendStatus: undefined, sendError: null } : item)
    : parsed
  const idsToReplace = new Set([optimisticId, canonicalMessageId].filter((id): id is string => Boolean(id)))
  const baseMessages = idsToReplace.size > 0
    ? state.messages.filter((item) => !idsToReplace.has(item.messageId))
    : state.messages
  return {
    cursor: frame.patch.cursor,
    messages: dedupeChatMessages([...baseMessages, ...normalized]),
  }
}
