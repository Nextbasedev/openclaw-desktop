import type { ChatBootstrapSnapshot, ToolCallProjection } from "../sync/types.contract";
import type { OCPlatformMessageData } from "../sync/types.contract";
import {
  emptyChatState,
  msgKey,
  reorder,
  runKey,
  seqKey,
  userKey,
  type ChatSessionState,
  type MessageRow,
  type RowKey,
  type ToolRow,
} from "./state";
import { readClientMessageId, readMessageId, readRole, readRunId, readSeq, textFromMessage } from "./text";

function toolRowFrom(tool: ToolCallProjection): ToolRow {
  return {
    toolCallId: tool.toolCallId,
    runId: tool.runId ?? null,
    name: tool.name,
    phase: tool.phase,
    status: tool.status,
    argsMeta: tool.argsMeta,
    resultMeta: tool.resultMeta,
    awaitingResult: tool.awaitingResult,
    startedAtMs: tool.startedAtMs ?? null,
    finishedAtMs: tool.finishedAtMs ?? null,
    updatedAtMs: tool.updatedAtMs ?? Date.now(),
  };
}

function chooseKey(message: OCPlatformMessageData, role: string, runId: string | null, messageId: string | null, seq: number): RowKey {
  if (role === "user") {
    const clientId = readClientMessageId(message);
    if (message.isOptimistic && clientId) return userKey(clientId);
    if (messageId) return msgKey(messageId);
    if (clientId) return userKey(clientId);
    return seqKey(seq);
  }
  // assistant / tool / other
  if (runId) return runKey(runId);
  if (messageId) return msgKey(messageId);
  return seqKey(seq);
}

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
    const role = readRole(message);
    const runId = readRunId(message);
    const messageId = readMessageId(message);
    const seq = readSeq(message) ?? state.maxSeq + 1;
    const key = chooseKey(message, role, runId, messageId, seq);
    const kind = role === "user" ? "user" : "assistant";

    const row: MessageRow = {
      key,
      kind,
      seq,
      ephemeralSeq: false,
      messageId,
      clientMessageId: readClientMessageId(message) ?? undefined,
      runId: runId ?? undefined,
      text: textFromMessage(message),
      attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
      toolCallIds: [],
      // active-run row stays in the live tail; everything else is history.
      finalized: !(runId && runId === activeRunId),
      isOptimistic: Boolean(message.isOptimistic),
      model: typeof message.model === "string" ? message.model : undefined,
      usage: message.usage,
      stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
      raw: message,
      updatedAtMs: Date.now(),
    };

    state.rows.set(key, row);
    if (messageId) state.byMessageId.set(messageId, key);
    if (row.clientMessageId) state.byClientId.set(row.clientMessageId, key);
    if (runId) state.byRunId.set(runId, key);
    if (seq > state.maxSeq) state.maxSeq = seq;
  }

  // tools (toolCalls preferred; falls back to tools)
  const tools = snapshot.toolCalls ?? snapshot.tools ?? [];
  for (const tool of tools) {
    state.tools.set(tool.toolCallId, toolRowFrom(tool));
    if (tool.runId) {
      const rowKey = state.byRunId.get(tool.runId);
      const row = rowKey ? state.rows.get(rowKey) : undefined;
      if (row && !row.toolCallIds.includes(tool.toolCallId)) row.toolCallIds.push(tool.toolCallId);
    }
  }

  // seed run rows from the active run so live-tail placement is consistent.
  if (snapshot.activeRun) {
    const rk = runKey(snapshot.activeRun.runId);
    state.runs.set(snapshot.activeRun.runId, {
      runId: snapshot.activeRun.runId,
      status: snapshot.activeRun.status,
      statusLabel: snapshot.activeRun.statusLabel ?? null,
      startedAtMs: snapshot.activeRun.startedAtMs ?? null,
      assistantKey: rk,
    });
  }

  reorder(state);
  return state;
}
