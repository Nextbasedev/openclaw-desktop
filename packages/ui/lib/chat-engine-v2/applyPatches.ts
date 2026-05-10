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

function patchMessage(frame: PatchFrame): unknown | null {
  if (frame.patch.type !== "chat.message.upsert" && frame.patch.type !== "chat.message.confirmed") return null
  return patchPayload(frame)?.message ?? null
}

function patchOptimisticId(frame: PatchFrame): string | null {
  if (frame.patch.type !== "chat.message.confirmed") return null
  const id = patchPayload(frame)?.optimisticId
  return typeof id === "string" && id.trim() ? id : null
}

function patchRemoveId(frame: PatchFrame): string | null {
  if (frame.patch.type !== "chat.message.remove") return null
  const id = patchPayload(frame)?.messageId
  return typeof id === "string" && id.trim() ? id : null
}

const ACTIVE_STATUSES = new Set<StreamStatus>(["queued", "running", "collect", "thinking", "tool_running", "streaming", "stopping", "restarting"])
const VALID_STATUSES = new Set<StreamStatus>(["idle", "connected", "queued", "running", "collect", "thinking", "tool_running", "streaming", "stopping", "restarting", "done", "error"])

export function statusFromPatch(frame: PatchFrame): { status: StreamStatus; label: string | null } | null {
  if (frame.patch.type !== "chat.status" && frame.patch.type !== "session.status" && frame.patch.type !== "session.upsert") return null
  const payload = patchPayload(frame)
  const status = payload?.status
  if (typeof status !== "string" || !VALID_STATUSES.has(status as StreamStatus)) return null
  const label = payload?.statusLabel ?? payload?.label ?? null
  return { status: status as StreamStatus, label: typeof label === "string" ? label : null }
}

export function patchImpliesActiveRun(frame: PatchFrame): boolean {
  const status = statusFromPatch(frame)
  if (status) return ACTIVE_STATUSES.has(status.status)
  if (frame.patch.type !== "chat.message.upsert" && frame.patch.type !== "chat.message.confirmed") return false
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
  const baseMessages = optimisticId
    ? state.messages.filter((item) => item.messageId !== optimisticId)
    : state.messages
  return {
    cursor: frame.patch.cursor,
    messages: dedupeChatMessages([...baseMessages, ...parsed]),
  }
}
