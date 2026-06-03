import type { ChatPatchPayload } from "../../sync/types.contract";
import { type ChatSessionState, type ToolRow } from "../state";
import { ensureAssistantRow, mergeToolRow } from "./rowHelpers";

/** chat.tool.started/update/result/error — upsert tool + attach to its run row. */
export function handleTool(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const tool = payload.toolCall;
  const toolCallId = payload.toolCallId ?? tool?.toolCallId;
  if (!toolCallId) return false;

  const prev = state.tools.get(toolCallId);
  const merged: ToolRow = tool
    ? mergeToolRow(tool, prev, payload)
    : {
        toolCallId,
        runId: prev?.runId ?? payload.runId ?? null,
        name: prev?.name ?? "tool",
        phase: payload.phase ?? prev?.phase ?? "start",
        status: prev?.status ?? "running",
        argsMeta: prev?.argsMeta,
        resultMeta: prev?.resultMeta,
        output: payload.output ?? payload.result ?? prev?.output,
        startedAtMs: prev?.startedAtMs ?? null,
        finishedAtMs: prev?.finishedAtMs ?? null,
        updatedAtMs: now,
      };
  state.tools.set(toolCallId, merged);

  const runId = merged.runId ?? payload.runId ?? undefined;
  if (!runId) return false;
  const { row: base, created } = ensureAssistantRow(state, runId);
  if (!base.toolCallIds.includes(toolCallId)) {
    const row = { ...base, toolCallIds: [...base.toolCallIds, toolCallId], updatedAtMs: now };
    state.rows.set(row.key, row);
  }
  return created;
}
