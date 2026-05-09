import type { ChatMessage } from "../../components/ChatView/types"
import { parseChatHistory } from "../chatHistoryParser"
import { dedupeChatMessages } from "../chatMessageDedupe"
import type { PatchFrame } from "./client"

type ApplyPatchState = {
  cursor: number
  messages: ChatMessage[]
}

function patchMessage(frame: PatchFrame): unknown | null {
  if (frame.patch.type !== "chat.message.upsert") return null
  const payload = frame.patch.payload
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  return (payload as { message?: unknown }).message ?? null
}

export function applyChatPatch(state: ApplyPatchState, frame: PatchFrame): ApplyPatchState {
  if (frame.patch.cursor <= state.cursor) return state
  const message = patchMessage(frame)
  if (!message) return { ...state, cursor: frame.patch.cursor }
  const parsed = parseChatHistory([message]).messages
  return {
    cursor: frame.patch.cursor,
    messages: dedupeChatMessages([...state.messages, ...parsed]),
  }
}
