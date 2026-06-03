import type { OCPlatformMessageData } from "../sync/types.contract";
import { cloneState, reorder, type ChatSessionState } from "./state";
import { rowFromMessage } from "./messageRow";

export interface OlderMessage {
  data: OCPlatformMessageData;
  openclawSeq: number;
  messageId: string | null;
  role: string | null;
}

/**
 * Merge an older page (from GET /api/chat/messages?beforeSeq=...) into history.
 * Idempotent: messages already present (by key) are skipped. Updates pagination
 * (`oldestLoadedSeq`, `hasOlder`). Does NOT touch cursor or the live tail.
 */
export function applyOlderMessages(prevState: ChatSessionState, messages: OlderMessage[]): ChatSessionState {
  if (!messages.length) {
    const state = cloneState(prevState);
    state.pagination.loadingOlder = false;
    return state;
  }
  const state = cloneState(prevState);
  const activeRunId = state.activeRun?.runId ?? null;
  let oldest = state.pagination.oldestLoadedSeq ?? Number.POSITIVE_INFINITY;
  let added = 0;

  for (const message of messages) {
    const data = { ...(message.data ?? {}), __openclaw: { ...(message.data?.__openclaw ?? {}), seq: message.openclawSeq } };
    const row = rowFromMessage(data, message.openclawSeq, activeRunId);
    if (state.rows.has(row.key)) continue; // already loaded
    row.finalized = true; // older messages are always history
    state.rows.set(row.key, row);
    if (row.messageId) state.byMessageId.set(row.messageId, row.key);
    if (row.clientMessageId) state.byClientId.set(row.clientMessageId, row.key);
    if (row.runId && !state.byRunId.has(row.runId)) state.byRunId.set(row.runId, row.key);
    if (row.seq > state.maxSeq) state.maxSeq = row.seq;
    if (row.seq < oldest) oldest = row.seq;
    added += 1;
  }

  state.pagination.oldestLoadedSeq = Number.isFinite(oldest) ? oldest : state.pagination.oldestLoadedSeq;
  state.pagination.loadingOlder = false;
  state.pagination.hasOlder = state.pagination.knownTotalMessages > state.rows.size;
  if (added > 0) reorder(state);
  return state;
}
