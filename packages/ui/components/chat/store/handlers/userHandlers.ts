import type { ChatPatchPayload } from "../../sync/types.contract";
import { msgKey, userKey, type ChatSessionState, type MessageRow, type RowKey } from "../state";
import { readMessageId, textFromMessage } from "../text";
import { setMessageIdIndex } from "./rowHelpers";

/** chat.user.created — insert/refresh the optimistic user row (key=client:<id>). */
export function handleUserCreated(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const message = payload.message ?? {};
  const clientId = payload.clientMessageId ?? message.__openclaw?.clientMessageId ?? payload.idempotencyKey;
  if (!clientId) return false;

  const key = userKey(clientId);
  const existing = state.rows.get(key);
  const seq = existing?.seq ?? state.maxSeq + 1;
  let membershipChanged = false;
  if (!existing) {
    state.maxSeq = Math.max(state.maxSeq, seq);
    membershipChanged = true;
  }
  const row: MessageRow = {
    key,
    kind: "user",
    seq,
    ephemeralSeq: true,
    messageId: null,
    clientMessageId: clientId,
    runId: payload.runId,
    text: textFromMessage(message),
    attachments: Array.isArray(message.attachments) ? message.attachments : existing?.attachments,
    toolCallIds: existing?.toolCallIds ?? [],
    finalized: false,
    isOptimistic: true,
    raw: message,
    updatedAtMs: now,
  };
  state.rows.set(key, row);
  state.byClientId.set(clientId, key);
  return membershipChanged;
}

/** chat.user.confirmed — reconcile optimistic -> canonical IN PLACE (same key). */
export function handleUserConfirmed(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const message = payload.message ?? {};
  const optimisticId = payload.optimisticId ?? payload.clientMessageId ?? null;
  const canonicalId = payload.messageId ?? readMessageId(message);
  const seq = payload.messageSeq ?? null;
  const existingKey: RowKey | undefined = optimisticId ? state.byClientId.get(optimisticId) : undefined;
  let membershipChanged = false;

  if (existingKey && state.rows.get(existingKey)) {
    const row = { ...state.rows.get(existingKey)! };
    row.messageId = canonicalId;
    if (seq != null) {
      row.seq = seq;
      row.ephemeralSeq = false;
      membershipChanged = true;
    }
    if (textFromMessage(message)) row.text = textFromMessage(message);
    row.isOptimistic = false;
    row.finalized = true; // a confirmed user message is final history
    row.raw = message;
    row.updatedAtMs = now;
    state.rows.set(existingKey, row);
    setMessageIdIndex(state, canonicalId, existingKey);
    return membershipChanged;
  }

  // No optimistic to join (joined mid-stream) -> upsert canonical user row.
  const newKey = canonicalId ? msgKey(canonicalId) : optimisticId ? userKey(optimisticId) : null;
  if (!newKey) return false;
  const existing = state.rows.get(newKey);
  const rowSeq = seq ?? existing?.seq ?? state.maxSeq + 1;
  if (!existing) {
    state.maxSeq = Math.max(state.maxSeq, rowSeq);
    membershipChanged = true;
  }
  state.rows.set(newKey, {
    key: newKey,
    kind: "user",
    seq: rowSeq,
    ephemeralSeq: false,
    messageId: canonicalId,
    clientMessageId: optimisticId ?? undefined,
    runId: payload.runId,
    text: textFromMessage(message),
    attachments: Array.isArray(message.attachments) ? message.attachments : existing?.attachments,
    toolCallIds: existing?.toolCallIds ?? [],
    finalized: true,
    isOptimistic: false,
    raw: message,
    updatedAtMs: now,
  });
  setMessageIdIndex(state, canonicalId, newKey);
  if (optimisticId) state.byClientId.set(optimisticId, newKey);
  return membershipChanged;
}
