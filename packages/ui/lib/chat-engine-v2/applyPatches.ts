import type { ChatMessage } from "../../components/ChatView/types"
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
  if (frame.patch.type !== "chat.message.upsert") return null
  return patchPayload(frame)?.message ?? null
}

function patchRemoveId(frame: PatchFrame): string | null {
  if (frame.patch.type !== "chat.message.remove") return null
  const id = patchPayload(frame)?.messageId
  return typeof id === "string" && id.trim() ? id : null
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
  return {
    cursor: frame.patch.cursor,
    messages: dedupeChatMessages([...state.messages, ...parsed]),
  }
}
