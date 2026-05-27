import { buildStableChatRows, type StableChatMessage } from "../chatStableIds"
import type { ChatMessage } from "../types"

export type { StableChatMessage }

export function buildStableVercelTimeline(messages: readonly ChatMessage[]) {
  return buildStableChatRows(messages, { coalesceAssistantTurns: true })
}
