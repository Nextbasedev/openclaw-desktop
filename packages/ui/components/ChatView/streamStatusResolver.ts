import type { StreamStatus } from "./types"

// Statuses that mean a run is actively working (UI shows "Writing…"/thinking).
const ACTIVE: ReadonlySet<StreamStatus> = new Set<StreamStatus>([
  "queued",
  "running",
  "collect",
  "thinking",
  "tool_running",
  "streaming",
  "stopping",
  "restarting",
])

// Statuses that mean the run has stopped and the UI should be quiet.
const TERMINAL: ReadonlySet<StreamStatus> = new Set<StreamStatus>([
  "done",
  "idle",
  "connected",
])

export function isActiveStreamStatusValue(status: StreamStatus): boolean {
  return ACTIVE.has(status)
}

export function isTerminalStreamStatusValue(status: StreamStatus): boolean {
  return TERMINAL.has(status)
}

export type ResolveStreamStatusInput = {
  // Semantic type of the incoming patch (e.g. "chat.assistant.final").
  semanticType: string | null
  // Explicit status the patch carried, if any.
  explicitStatus: StreamStatus | null
  // Whether the patch implies an active run (optimistic user send / active status).
  impliesActiveRun: boolean
  // Current stream status before this patch.
  currentStatus: StreamStatus
  // Whether the timeline (after applying the patch) has an assistant answer
  // after the last user message — i.e. the current turn is effectively answered.
  hasAnswerAfterLastUser: boolean
  // Whether the answered turn still has a visible running tool. If yes, keep
  // active tool state visible even though assistant text is present.
  hasRunningToolAfterLastUser?: boolean
}

// Single source of truth for how a patch moves the stream status. Fixes two
// real bugs while preserving genuine active flows:
//
//  1. Stuck "Writing…": the terminal `chat.run.done` status can be dropped
//     upstream (the code already recovers this on reconnect, but never in the
//     live stream). When the assistant's FINAL message lands and an answer is
//     present, settle to idle so the completed answer stops showing "Writing…".
//
//  2. Resurrected "Writing…": late background/tool/duplicate message patches can
//     re-imply an active run after the turn is already answered. Never re-imply
//     "thinking" once an answer exists after the last user turn. A genuine new
//     turn always starts with a fresh optimistic user row, which makes
//     hasAnswerAfterLastUser=false again, so real new sends still activate.
//
// It also folds in the existing guard: do not apply a terminal status while the
// current turn is still active and has not produced its first answer yet.
export function resolveNextStreamStatus(input: ResolveStreamStatusInput): StreamStatus {
  const {
    semanticType,
    explicitStatus,
    impliesActiveRun,
    currentStatus,
    hasAnswerAfterLastUser,
    hasRunningToolAfterLastUser = false,
  } = input

  const explicitActive = explicitStatus ? ACTIVE.has(explicitStatus) : false
  const answeredWithoutRunningTool = hasAnswerAfterLastUser && !hasRunningToolAfterLastUser

  // (1) Settle a completed run whose terminal signal was lost.
  if (semanticType === "chat.assistant.final" && answeredWithoutRunningTool && !explicitActive) {
    return "idle"
  }

  // (2) Do not let a stale active status keep/resurrect "Writing…" after the
  // answered turn has no visible running tool left. This covers backend/replay
  // patches that carry runStatus:"streaming" or "tool_running" even though the
  // final assistant text is already rendered.
  if (
    answeredWithoutRunningTool &&
    explicitActive &&
    semanticType !== "chat.assistant.delta" &&
    !semanticType?.startsWith("chat.tool.")
  ) {
    return "idle"
  }

  // (3) Only imply "thinking" when the current turn is genuinely unanswered.
  const impliedThinking = impliesActiveRun && !hasAnswerAfterLastUser ? "thinking" : null
  const rawNext: StreamStatus | null = explicitStatus ?? impliedThinking

  // (4) Do not surface a terminal status while still waiting for the first
  //     answer of an active turn (prevents a premature "done" flicker).
  if (rawNext && TERMINAL.has(rawNext) && ACTIVE.has(currentStatus) && !hasAnswerAfterLastUser) {
    return currentStatus
  }

  return rawNext ?? currentStatus
}
