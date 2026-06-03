import type { ChatPatchPayload, ToolCallProjection } from "../../sync/types.contract";
import { runKey, type ChatSessionState, type MessageRow, type RowKey, type ToolRow } from "../state";

export const TERMINAL_RUN_STATUS: ReadonlySet<string> = new Set(["done", "error", "aborted"]);

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

export function mergeToolRow(tool: ToolCallProjection, prev: ToolRow | undefined, payload: ChatPatchPayload): ToolRow {
  const output = payload.output !== undefined ? payload.output : payload.result !== undefined ? payload.result : prev?.output;
  return {
    toolCallId: tool.toolCallId,
    runId: tool.runId ?? prev?.runId ?? payload.runId ?? null,
    name: tool.name ?? prev?.name ?? "tool",
    phase: tool.phase ?? prev?.phase ?? "start",
    status: tool.status ?? prev?.status ?? "running",
    argsMeta: tool.argsMeta ?? prev?.argsMeta,
    resultMeta: tool.resultMeta ?? prev?.resultMeta,
    awaitingResult: tool.awaitingResult ?? prev?.awaitingResult,
    output,
    startedAtMs: tool.startedAtMs ?? prev?.startedAtMs ?? null,
    finishedAtMs: tool.finishedAtMs ?? prev?.finishedAtMs ?? null,
    updatedAtMs: tool.updatedAtMs ?? Date.now(),
  };
}
