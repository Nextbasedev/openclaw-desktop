import type { ChatPatchPayload, RunStatus } from "../../sync/types.contract";
import { type ChatSessionState } from "../state";
import { ensureAssistantRow, TERMINAL_RUN_STATUS } from "./rowHelpers";

/**
 * chat.run.status/streaming/done/error/aborted + chat.status.
 * Single owner of run status + activeRun (server nulls activeRun on terminal).
 */
export function handleRunStatus(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const runId = payload.runId;
  const runStatus = (payload.runStatus as string | undefined) ?? (payload.status as string | undefined);
  let membershipChanged = false;

  if (runId && runStatus) {
    const { row: base, created } = ensureAssistantRow(state, runId);
    if (created) membershipChanged = true;
    const row = { ...base };
    state.runs.set(runId, {
      runId,
      status: runStatus as RunStatus,
      statusLabel: payload.statusLabel ?? null,
      startedAtMs: payload.activeRun?.startedAtMs ?? state.runs.get(runId)?.startedAtMs ?? null,
      assistantKey: row.key,
    });
    if (TERMINAL_RUN_STATUS.has(runStatus)) {
      if (!row.finalized) { row.finalized = true; membershipChanged = true; } // move to history
      row.updatedAtMs = now;
      state.rows.set(row.key, row);
    }
  }

  // activeRun is authoritative — server provides null on terminal runs.
  state.activeRun = payload.activeRun ?? null;
  if (payload.runStatus) state.status = payload.runStatus;
  else if (typeof payload.status === "string") state.status = payload.status as typeof state.status;
  if (payload.statusLabel !== undefined) state.statusLabel = payload.statusLabel ?? null;
  return membershipChanged;
}
