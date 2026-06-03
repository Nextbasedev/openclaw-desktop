import type { OCPlatformMessageData, ToolCallProjection } from "../sync/types.contract";
import { msgKey, runKey, seqKey, userKey, type MessageRow, type RowKey, type ToolRow } from "./state";
import { readClientMessageId, readMessageId, readRole, readRunId, readSeq, textFromMessage } from "./text";

/** Pick the stable row key for a (history) message based on role/run/id. */
export function chooseKey(message: OCPlatformMessageData, role: string, runId: string | null, messageId: string | null, seq: number): RowKey {
  if (role === "user") {
    const clientId = readClientMessageId(message);
    if (message.isOptimistic && clientId) return userKey(clientId);
    if (messageId) return msgKey(messageId);
    if (clientId) return userKey(clientId);
    return seqKey(seq);
  }
  if (runId) return runKey(runId);
  if (messageId) return msgKey(messageId);
  return seqKey(seq);
}

/** Build a finalized history MessageRow from a serialized message + fallback seq. */
export function rowFromMessage(message: OCPlatformMessageData, fallbackSeq: number, activeRunId: string | null): MessageRow {
  const role = readRole(message);
  const runId = readRunId(message);
  const messageId = readMessageId(message);
  const seq = readSeq(message) ?? fallbackSeq;
  const key = chooseKey(message, role, runId, messageId, seq);
  return {
    key,
    kind: role === "user" ? "user" : "assistant",
    seq,
    ephemeralSeq: false,
    messageId,
    clientMessageId: readClientMessageId(message) ?? undefined,
    runId: runId ?? undefined,
    text: textFromMessage(message),
    attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
    toolCallIds: [],
    // the active-run row stays in the live tail; everything else is history.
    finalized: !(runId && runId === activeRunId),
    isOptimistic: Boolean(message.isOptimistic),
    model: typeof message.model === "string" ? message.model : undefined,
    usage: message.usage,
    stopReason: typeof message.stopReason === "string" ? message.stopReason : undefined,
    raw: message,
    updatedAtMs: Date.now(),
  };
}

export function toolRowFromProjection(tool: ToolCallProjection): ToolRow {
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
