import type { ChatPatchPayload } from "../../sync/types.contract";
import { type ChatSessionState, type SubagentRow, type SubagentStatus } from "../state";

/**
 * chat.subagent.spawn_started / spawn_linked / spawn_done / spawn_failed /
 * child_activity. A sub-agent (sessions_spawn) is keyed by its spawning toolCallId
 * and rendered as a first-class card instead of raw sessions_spawn tool JSON.
 *
 * Note: run-state on these frames is NON-authoritative (idle snapshot) — that is
 * handled by reconcileRunState ignoring chat.subagent.* entirely. Here we only
 * project the sub-agent's own lifecycle.
 */
export function handleSubagent(state: ChatSessionState, payload: ChatPatchPayload, now: number): boolean {
  const toolCallId = payload.toolCallId;
  if (!toolCallId) return false;

  const semantic = payload.semanticType ?? "";
  const prev = state.subagents.get(toolCallId);

  let status: SubagentStatus = prev?.status ?? "spawning";
  switch (semantic) {
    case "chat.subagent.spawn_started": status = prev?.status === "done" || prev?.status === "failed" ? prev.status : "spawning"; break;
    case "chat.subagent.spawn_linked": if (status !== "done" && status !== "failed") status = "running"; break;
    case "chat.subagent.child_activity": if (status !== "done" && status !== "failed") status = "running"; break;
    case "chat.subagent.spawn_done": status = "done"; break;
    case "chat.subagent.spawn_failed": status = "failed"; break;
  }

  const isActivity = semantic === "chat.subagent.child_activity";
  const row: SubagentRow = {
    toolCallId,
    runId: payload.runId ?? prev?.runId ?? null,
    // First-write-wins: the initial spawn_started carries the real label/task;
    // a later spawn_started re-emits the generic "Sub-agent" fallback / null task.
    label: prev?.label ?? (typeof payload.label === "string" && payload.label ? payload.label : undefined),
    task: prev?.task ?? (typeof payload.task === "string" && payload.task ? payload.task : undefined),
    childSessionKey: (typeof payload.childSessionKey === "string" && payload.childSessionKey) || prev?.childSessionKey || null,
    status,
    activityCount: (prev?.activityCount ?? 0) + (isActivity ? 1 : 0),
    error: payload.error ?? prev?.error,
    updatedAtMs: now,
  };
  state.subagents.set(toolCallId, row);
  return !prev; // membership change only when first seen
}
