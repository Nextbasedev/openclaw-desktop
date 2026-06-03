import type { ChatBootstrapSnapshot } from "../sync/types.contract";
import { emptyChatState, reorder, runKey, type ChatSessionState } from "./state";
import { rowFromMessage, toolRowFromProjection } from "./messageRow";

/**
 * Build an initial ChatSessionState from a bootstrap snapshot. Atomic reset:
 * any prior state for the session is discarded (this is the recovery path).
 */
export function applyBootstrap(snapshot: ChatBootstrapSnapshot): ChatSessionState {
  const state = emptyChatState(snapshot.sessionKey);
  state.cursor = snapshot.cursor ?? 0;
  state.status = snapshot.runStatus ?? "idle";
  state.statusLabel = snapshot.statusLabel ?? null;
  state.activeRun = snapshot.activeRun ?? null;
  state.conn = "live";

  state.pagination = {
    knownTotalMessages: snapshot.knownTotalMessages ?? snapshot.messageCount ?? 0,
    oldestLoadedSeq: snapshot.oldestLoadedSeq ?? null,
    hasOlder: Boolean(snapshot.hasOlder),
    loadingOlder: false,
  };

  const activeRunId = snapshot.activeRun?.runId ?? null;

  for (let i = 0; i < (snapshot.messages?.length ?? 0); i += 1) {
    const message = snapshot.messages[i] ?? {};
    const row = rowFromMessage(message, state.maxSeq + 1, activeRunId);
    state.rows.set(row.key, row);
    if (row.messageId) state.byMessageId.set(row.messageId, row.key);
    if (row.clientMessageId) state.byClientId.set(row.clientMessageId, row.key);
    if (row.runId) state.byRunId.set(row.runId, row.key);
    if (row.seq > state.maxSeq) state.maxSeq = row.seq;
  }

  const tools = snapshot.toolCalls ?? snapshot.tools ?? [];
  for (const tool of tools) {
    state.tools.set(tool.toolCallId, toolRowFromProjection(tool));
    if (tool.runId) {
      const rowKey = state.byRunId.get(tool.runId);
      const row = rowKey ? state.rows.get(rowKey) : undefined;
      if (row && !row.toolCallIds.includes(tool.toolCallId)) row.toolCallIds.push(tool.toolCallId);
    }
  }

  if (snapshot.activeRun) {
    state.runs.set(snapshot.activeRun.runId, {
      runId: snapshot.activeRun.runId,
      status: snapshot.activeRun.status,
      statusLabel: snapshot.activeRun.statusLabel ?? null,
      startedAtMs: snapshot.activeRun.startedAtMs ?? null,
      assistantKey: runKey(snapshot.activeRun.runId),
    });
  }

  reorder(state);
  return state;
}
