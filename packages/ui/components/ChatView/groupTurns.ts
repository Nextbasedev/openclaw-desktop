import type { ChatMessage } from "./types"
import { isSystemInjectedText } from "@/lib/systemInjectedMessage"

// A single conversation "turn": one real user message (when present) followed by
// every assistant message the gateway emitted in response (preamble text, post-
// tool text, final text, tool-only messages). The render layer draws each turn as
// ONE response card instead of one card per assistant message.
//
// Boundaries are REAL user messages only. Gateway-injected "System (untrusted):
// [date] …" notices (which are stored with role:"user") are transparent: they are
// neither a boundary nor rendered, so they can't split an answer in two.

/** A message plus its index in the source (rendered) array, for stable keys/anchors. */
export type TurnMessage = {
  message: ChatMessage
  index: number
}

export type ChatTurn = {
  /** Real user message that opened this turn, if any (leading assistants → null). */
  user: TurnMessage | null
  /** Assistant messages belonging to this turn, in emission order. */
  assistants: TurnMessage[]
  /** Stable key source: messageId of the first message in the turn. */
  keyMessageId: string
}

/** A real user turn boundary — excludes transparent system injections. */
export function isRealUserMessage(message: Pick<ChatMessage, "role" | "text">): boolean {
  return message.role === "user" && !isSystemInjectedText(message.text)
}

/** A message that should be dropped entirely (transparent system injection). */
export function isTransparentSystemMessage(
  message: Pick<ChatMessage, "role" | "text">,
): boolean {
  return message.role === "user" && isSystemInjectedText(message.text)
}

/**
 * Group an ordered message list into turns. Pure and order-preserving.
 * - real user message → starts a new turn
 * - assistant message → appended to the current turn (creating a userless turn
 *   if it appears before any user message)
 * - transparent system injection → skipped (not a boundary, not rendered)
 *
 * Each entry carries its index in `messages` so the renderer can look up the
 * matching React row key / scroll-anchor metadata.
 */
export function groupTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  let current: ChatTurn | null = null

  messages.forEach((message, index) => {
    if (isTransparentSystemMessage(message)) {
      return
    }
    if (message.role === "user") {
      current = { user: { message, index }, assistants: [], keyMessageId: message.messageId }
      turns.push(current)
      return
    }
    // assistant
    if (!current) {
      current = { user: null, assistants: [], keyMessageId: message.messageId }
      turns.push(current)
    }
    current.assistants.push({ message, index })
  })

  return turns
}
