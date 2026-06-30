import type { ChatMessage, InlineToolCall } from "./types"
import { applyTerminalToolState } from "@/lib/chatToolDisplay"
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

// ---------------------------------------------------------------------------
// buildTurnView: the pure render-decision layer for a single turn.
//
// All of the "what shows and in what order" logic lives here so it can be unit
// tested against the real symptom scenarios (instead of being trapped in JSX):
//   - one merged tool stack rendered ABOVE all text (Option B)
//   - a SINGLE action bar, on the last text block, ONLY when the turn is complete
//   - tool-only / duplicate rows suppressed so they don't draw an empty bubble
// The JSX renderer is a thin consumer of this output.
// ---------------------------------------------------------------------------

export type TurnAssistantRow = {
  message: ChatMessage
  index: number
  /** Tool calls owned by this assistant message, after terminal-state cleanup. */
  toolCalls: InlineToolCall[]
}

export type TurnViewInput = {
  /** True while the run is actively generating. */
  isGenerating: boolean
  /** True when this is the last (active) turn in the list. */
  isLastTurn: boolean
  /** Index of the most recent real user message in the source array. */
  latestRenderedUserIndex: number
  duplicateToolOnlyRows: Set<string>
  suppressedToolCallMessages: Set<string>
  groupedToolCalls: Map<string, InlineToolCall[]>
  terminalToolState: Map<string, InlineToolCall>
}

export type TurnView = {
  /** Whether the turn may show its action bar (not active / generation stopped). */
  turnComplete: boolean
  /** Visible assistant rows (source for subagent cards + reasoning blocks). */
  assistantRows: TurnAssistantRow[]
  /** All of the turn's tool calls, merged in emission order (the top stack). */
  toolCalls: InlineToolCall[]
  /** Whether the merged tool stack should default open (no text in the turn). */
  toolsDefaultOpen: boolean
  /** Assistant rows that render a text/attachment bubble, in order, below tools. */
  textRows: TurnAssistantRow[]
  /** The single text row that owns the action bar (null = none yet). */
  actionBarMessageId: string | null
  /** Whether the assistant response card has anything to draw at all. */
  hasAssistantContent: boolean
}

/**
 * Compute the render plan for one turn. Pure: same inputs → same output.
 */
export function buildTurnView(turn: ChatTurn, input: TurnViewInput): TurnView {
  const {
    isGenerating,
    isLastTurn,
    latestRenderedUserIndex,
    duplicateToolOnlyRows,
    suppressedToolCallMessages,
    groupedToolCalls,
    terminalToolState,
  } = input

  const turnComplete = !isLastTurn || !isGenerating

  const assistantRows: TurnAssistantRow[] = turn.assistants
    .map(({ message, index }) => {
      const isDuplicateToolOnlyRow = duplicateToolOnlyRows.has(message.messageId)
      const rawToolCalls =
        !suppressedToolCallMessages.has(message.messageId) && !isDuplicateToolOnlyRow
          ? groupedToolCalls.get(message.messageId) ?? message.toolCalls ?? []
          : []
      const shouldFinalizeDisplayedTools =
        index < latestRenderedUserIndex ||
        !isGenerating ||
        rawToolCalls.some((tool) => tool.status === "success" || tool.status === "error")
      const toolCalls = applyTerminalToolState(rawToolCalls, terminalToolState, {
        finalizeStaleRunning: shouldFinalizeDisplayedTools,
      })
      const suppressLiveToolOnlyAssistantRow =
        index > latestRenderedUserIndex &&
        !message.text.trim() &&
        !message.reasoningText &&
        suppressedToolCallMessages.has(message.messageId)
      const hidden =
        suppressLiveToolOnlyAssistantRow ||
        (isDuplicateToolOnlyRow &&
          !message.text.trim() &&
          !message.reasoningText &&
          !message.attachments?.length)
      return { message, index, toolCalls, hidden }
    })
    .filter((row) => !row.hidden)
    .map(({ message, index, toolCalls }) => ({ message, index, toolCalls }))

  const toolCalls = assistantRows.flatMap((row) => row.toolCalls)
  const textRows = assistantRows.filter(
    (row) => row.message.text.trim() || row.message.attachments?.length,
  )
  const lastText = textRows.length ? textRows[textRows.length - 1] : null
  const actionBarMessageId = lastText && turnComplete ? lastText.message.messageId : null
  const hasAssistantContent =
    toolCalls.length > 0 ||
    textRows.length > 0 ||
    assistantRows.some((row) => Boolean(row.message.reasoningText))

  return {
    turnComplete,
    assistantRows,
    toolCalls,
    toolsDefaultOpen: textRows.length === 0,
    textRows,
    actionBarMessageId,
    hasAssistantContent,
  }
}
