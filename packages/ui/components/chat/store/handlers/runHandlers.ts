import type { ChatPatchPayload, RunStatus } from "../../sync/types.contract";
import { type ChatSessionState } from "../state";
import { TERMINAL_RUN_STATUS } from "./rowHelpers";

/**
 * Run lifecycle is authoritative on EVERY patch, not just chat.run.* frames.
 *
 * The real wire embeds the current run state (`runStatus` + `activeRun`) in every
 * frame, and delivers the SUCCESS terminal (`runStatus:done, activeRun:null`)
 * inside `chat.assistant.final` — there is NO dedicated `chat.run.done` frame.
 * So applyPatch calls this after every content handler. It:
 *  - keeps the per-run status registry current,
 *  - finalizes the run's assistant row on a terminal status (moves live -> history),
 *  - mirrors `activeRun` (authoritative; server nulls it on terminal) so the
 *    Composer stops showing "Stop" and isGenerating clears.
 *
 * It does NOT create rows — the assistant row is created lazily by the first
 * delta / tool / final; a thinking placeholder covers the gap before then.
 */
export function reconcileRunState(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const runStatus = (payload.runStatus as string | undefined) ?? (payload.status as string | undefined);
  const hasActiveRun = payload.activeRun !== undefined; // present (object or explicit null)
  if (runStatus === undefined && !hasActiveRun) return false; // frame carries no run info

  let membershipChanged = false;
  const runId = payload.runId ?? payload.activeRun?.runId ?? undefined;

  if (runId && runStatus) {
    const existingKey = state.byRunId.get(runId);
    state.runs.set(runId, {
      runId,
      status: runStatus as RunStatus,
      statusLabel: payload.statusLabel ?? null,
      startedAtMs: payload.activeRun?.startedAtMs ?? state.runs.get(runId)?.startedAtMs ?? null,
      assistantKey: existingKey ?? state.runs.get(runId)?.assistantKey ?? null,
    });
    if (TERMINAL_RUN_STATUS.has(runStatus) && existingKey) {
      const row = state.rows.get(existingKey);
      if (row && !row.finalized) {
        state.rows.set(existingKey, { ...row, finalized: true, updatedAtMs: now });
        membershipChanged = true; // live tail -> history
      }
    }
  }

  if (hasActiveRun) state.activeRun = payload.activeRun ?? null;
  else if (runStatus && TERMINAL_RUN_STATUS.has(runStatus)) state.activeRun = null;
  if (runStatus) state.status = runStatus as typeof state.status;
  if (payload.statusLabel !== undefined) state.statusLabel = payload.statusLabel ?? null;
  return membershipChanged;
}
