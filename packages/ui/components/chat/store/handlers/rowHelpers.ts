import type { ChatPatchPayload, ToolCallProjection } from "../../sync/types.contract";
import { runKey, type ChatSessionState, type MessageRow, type RowKey, type ToolRow } from "../state";

export const TERMINAL_RUN_STATUS: ReadonlySet<string> = new Set(["done", "error", "aborted"]);

/**
 * Advance the seq high-water mark to a server-assigned seq. Optimistic rows get
 * `maxSeq + 1`; if maxSeq isn't kept at/above the largest server seq, a later
 * optimistic row gets a tiny seq and sorts ABOVE prior finalized rows (the
 * "second user message renders above the first assistant reply" bug). Call this
 * whenever a canonical/server seq is applied to ANY row (new or existing).
 */
export function noteSeq(state: ChatSessionState, seq: number | null | undefined): void {
  if (typeof seq === "number" && Number.isFinite(seq) && seq > state.maxSeq) state.maxSeq = seq;
}

/**
 * Find or create the assistant row for a run. The row key is run:<runId> and is
 * preserved across delta -> final so React never remounts the streaming row.
 */
export function ensureAssistantRow(state: ChatSessionState, runId: string): { row: MessageRow; created: boolean } {
  const existingKey = state.byRunId.get(runId);
  if (existingKey) {
    const existing = state.rows.get(existingKey);
    if (existing) return { row: existing, created: false };
  }
  const key = runKey(runId);
  const seq = state.maxSeq + 1;
  state.maxSeq = seq;
  const row: MessageRow = {
    key,
    kind: "assistant",
    seq,
    ephemeralSeq: true,
    messageId: null,
    runId,
    text: "",
    toolCallIds: [],
    finalized: false,
    updatedAtMs: Date.now(),
  };
  state.rows.set(key, row);
  state.byRunId.set(runId, key);
  return { row, created: true };
}

export function setMessageIdIndex(state: ChatSessionState, messageId: string | null, key: RowKey): void {
  if (messageId) state.byMessageId.set(messageId, key);
}

/** Mirror of the middleware's awaiting-placeholder check (projection.ts). */
function isAwaitingResultMeta(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).awaitingResult === true);
}

export function mergeToolRow(tool: ToolCallProjection, prev: ToolRow | undefined, payload: ChatPatchPayload): ToolRow {
  const output = payload.output !== undefined ? payload.output : payload.result !== undefined ? payload.result : prev?.output;
  const status = tool.status ?? prev?.status ?? "running";
  const resultMeta = tool.resultMeta ?? prev?.resultMeta;
  // `tool` is the server's full current projection. Take awaiting straight from it
  // (true only when the server says so OR the resultMeta is still the awaiting
  // placeholder) -- do NOT `?? prev`, which kept a stale `true` after the real
  // result landed -> card stuck "waiting for result…" under a DONE badge.
  const awaitingResult = tool.awaitingResult === true || isAwaitingResultMeta(resultMeta);
  return {
    toolCallId: tool.toolCallId,
    runId: tool.runId ?? prev?.runId ?? payload.runId ?? null,
    name: tool.name ?? prev?.name ?? "tool",
    phase: tool.phase ?? prev?.phase ?? "start",
    status,
    argsMeta: tool.argsMeta ?? prev?.argsMeta,
    resultMeta,
    awaitingResult,
    output,
    startedAtMs: tool.startedAtMs ?? prev?.startedAtMs ?? null,
    finishedAtMs: tool.finishedAtMs ?? prev?.finishedAtMs ?? null,
    updatedAtMs: tool.updatedAtMs ?? Date.now(),
  };
}
