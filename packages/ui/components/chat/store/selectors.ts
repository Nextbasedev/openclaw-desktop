import type { ChatSessionState, MessageRow, ToolRow } from "./state";

/** All rows in seq order. */
export function orderedRows(state: ChatSessionState): MessageRow[] {
  return state.order.map((key) => state.rows.get(key)!).filter(Boolean);
}

/** Finalized rows for the virtualized history zone. */
export function historyRows(state: ChatSessionState): MessageRow[] {
  return orderedRows(state).filter((row) => row.finalized);
}

/** Unfinalized rows (active run + optimistic) for the non-virtualized live tail. */
export function liveRows(state: ChatSessionState): MessageRow[] {
  return orderedRows(state).filter((row) => !row.finalized);
}

/** Ordered tool rows belonging to a run/assistant row. */
export function toolsForRow(state: ChatSessionState, row: MessageRow): ToolRow[] {
  return row.toolCallIds.map((id) => state.tools.get(id)).filter((t): t is ToolRow => Boolean(t));
}

export function toolsForRun(state: ChatSessionState, runId: string): ToolRow[] {
  return [...state.tools.values()]
    .filter((t) => t.runId === runId)
    .sort((a, b) => (a.startedAtMs ?? 0) - (b.startedAtMs ?? 0));
}

export function isGenerating(state: ChatSessionState): boolean {
  return state.activeRun != null && ["queued", "thinking", "streaming", "tool_running"].includes(state.activeRun.status);
}

export function thinkingPlaceholderVisible(state: ChatSessionState): boolean {
  if (!state.activeRun) return false;
  if (!["queued", "thinking"].includes(state.activeRun.status)) return false;
  // Only show when the active run has no visible assistant text yet.
  const key = state.byRunId.get(state.activeRun.runId);
  const row = key ? state.rows.get(key) : undefined;
  return !row || (!row.text && row.toolCallIds.length === 0);
}
