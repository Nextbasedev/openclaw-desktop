import type { ChatPatchPayload } from "../../sync/types.contract";
import { msgKey, runKey, type ChatSessionState, type MessageRow, type RowKey } from "../state";
import { readMessageId, readRole, textFromMessage } from "../text";
import { ensureAssistantRow, noteSeq, setMessageIdIndex } from "./rowHelpers";

/** chat.assistant.delta — cumulative full text into the run row (set, not append). */
export function handleAssistantDelta(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const runId = payload.runId;
  if (!runId) return false;
  const { row: base, created } = ensureAssistantRow(state, runId);
  const row = { ...base };
  const text = textFromMessage(payload.message) || payload.text || "";
  if (text) row.text = text;
  row.messageId = row.messageId ?? payload.messageId ?? null;
  row.finalized = false;
  row.updatedAtMs = now;
  state.rows.set(row.key, row);
  return created;
}

/** chat.reasoning.delta — full reasoning text (falls back to accumulating deltas). */
export function handleReasoningDelta(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const runId = payload.runId;
  if (!runId) return false;
  const { row: base, created } = ensureAssistantRow(state, runId);
  const row = { ...base };
  const full = typeof payload.text === "string" ? payload.text : "";
  const delta = typeof payload.delta === "string" ? payload.delta : "";
  row.reasoning = full || `${row.reasoning ?? ""}${delta}`;
  row.updatedAtMs = now;
  state.rows.set(row.key, row);
  return created;
}

/** chat.message.upsert / chat.assistant.final / chat.final — canonical message body. */
export function handleCanonicalMessage(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const message = payload.message ?? {};
  const role = readRole(message);
  const canonicalId = payload.messageId ?? readMessageId(message);
  const seq = payload.messageSeq ?? null;
  const runId = payload.runId ?? message.__openclaw?.runId ?? undefined;

  if (role === "user") return upsertCanonicalUser(state, payload, now, canonicalId, seq, runId);
  return finalizeAssistant(state, payload, now, canonicalId, seq, runId);
}

function upsertCanonicalUser(
  state: ChatSessionState, payload: ChatPatchPayload, now: number,
  canonicalId: string | null, seq: number | null, runId: string | undefined,
): boolean {
  const message = payload.message ?? {};
  const key = canonicalId ? msgKey(canonicalId) : null;
  if (!key) return false;
  const existing = state.rows.get(key);
  const rowSeq = seq ?? existing?.seq ?? state.maxSeq + 1;
  let membershipChanged = false;
  noteSeq(state, rowSeq);
  if (!existing) membershipChanged = true;
  state.rows.set(key, {
    key, kind: "user", seq: rowSeq, ephemeralSeq: false, messageId: canonicalId, runId,
    text: textFromMessage(message),
    attachments: Array.isArray(message.attachments) ? message.attachments : existing?.attachments,
    toolCallIds: existing?.toolCallIds ?? [], finalized: true, raw: message, updatedAtMs: now,
  });
  setMessageIdIndex(state, canonicalId, key);
  return membershipChanged;
}

function finalizeAssistant(
  state: ChatSessionState, payload: ChatPatchPayload, now: number,
  canonicalId: string | null, seq: number | null, runId: string | undefined,
): boolean {
  const message = payload.message ?? {};
  let key: RowKey | undefined = runId ? state.byRunId.get(runId) : undefined;
  if (!key && canonicalId) key = state.byMessageId.get(canonicalId);
  let membershipChanged = false;
  if (!key) {
    key = runId ? runKey(runId) : canonicalId ? msgKey(canonicalId) : undefined;
    if (key) membershipChanged = true;
  }
  if (!key) return false;

  const existing = state.rows.get(key);
  const rowSeq = seq ?? existing?.seq ?? state.maxSeq + 1;
  if (seq != null && existing && existing.ephemeralSeq) membershipChanged = true;
  noteSeq(state, rowSeq);

  const row: MessageRow = {
    key,
    kind: "assistant",
    seq: rowSeq,
    ephemeralSeq: seq == null && (existing?.ephemeralSeq ?? true),
    messageId: canonicalId ?? existing?.messageId ?? null,
    runId: runId ?? existing?.runId,
    text: textFromMessage(message) || existing?.text || "",
    reasoning: existing?.reasoning,
    toolCallIds: existing?.toolCallIds ?? [],
    finalized: existing?.finalized ?? false, // run.done flips this
    model: typeof message.model === "string" ? message.model : existing?.model,
    usage: message.usage ?? existing?.usage,
    stopReason: typeof message.stopReason === "string" ? message.stopReason : existing?.stopReason,
    raw: message,
    updatedAtMs: now,
  };
  state.rows.set(key, row);
  setMessageIdIndex(state, canonicalId, key);
  if (runId) state.byRunId.set(runId, key);
  return membershipChanged;
}
