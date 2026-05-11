import type { AppContext } from "../../app.js";
import type { ProjectedRun, ProjectedToolCall, RunStatus } from "./repo.runs.js";

export const CHAT_PROJECTION_VERSION = 3;

export type BootstrapRunStatus = "idle" | RunStatus;

export function canonicalRunStatusFromLegacy(status: unknown): BootstrapRunStatus {
  if (typeof status !== "string") return "idle";
  const normalized = status.trim().toLowerCase();
  if (["running", "started", "accepted", "thinking", "pending"].includes(normalized)) return "thinking";
  if (["streaming"].includes(normalized)) return "streaming";
  if (["tool_running", "tool-running", "tool"].includes(normalized)) return "tool_running";
  if (["done", "complete", "completed", "success", "succeeded", "finished"].includes(normalized)) return "done";
  if (["error", "failed", "failure"].includes(normalized)) return "error";
  if (["aborted", "abort", "cancelled", "canceled"].includes(normalized)) return "aborted";
  return "idle";
}

export function legacySessionStatusFromRunStatus(status: BootstrapRunStatus): string | null {
  if (status === "idle") return null;
  if (["queued", "thinking", "streaming", "tool_running"].includes(status)) return "running";
  return status;
}

export function runStatusLabel(status: BootstrapRunStatus, run: ProjectedRun | null, legacyLabel: unknown): string | null {
  if (run?.statusLabel) return run.statusLabel;
  if (typeof legacyLabel === "string" && legacyLabel.trim()) return legacyLabel;
  if (["queued", "thinking"].includes(status)) return "Thinking";
  if (status === "streaming") return "Streaming";
  return null;
}

export function activeRunProjection(run: ProjectedRun | null) {
  if (!run || !["queued", "thinking", "streaming", "tool_running"].includes(run.status)) return null;
  return {
    runId: run.runId,
    gatewayRunId: run.gatewayRunId,
    clientMessageId: run.clientMessageId,
    idempotencyKey: run.idempotencyKey,
    status: run.status,
    statusLabel: run.statusLabel,
    startedAtMs: run.startedAtMs,
    updatedAtMs: run.updatedAtMs,
  };
}

export function toolCallProjection(tool: ProjectedToolCall) {
  return {
    toolCallId: tool.toolCallId,
    id: tool.toolCallId,
    sessionKey: tool.sessionKey,
    runId: tool.runId,
    messageId: tool.messageId,
    name: tool.name,
    phase: tool.phase,
    status: tool.status,
    argsMeta: tool.argsMeta,
    resultMeta: tool.resultMeta,
    startedAtMs: tool.startedAtMs,
    finishedAtMs: tool.finishedAtMs,
    updatedAtMs: tool.updatedAtMs,
  };
}

export function canonicalPatchPayload(params: {
  sessionKey: string;
  semanticType: string;
  payload?: Record<string, unknown>;
  run?: ProjectedRun | null;
  tool?: ProjectedToolCall | null;
  messageId?: string | null;
  legacyStatus?: unknown;
  legacyStatusLabel?: unknown;
}) {
  const status = params.run?.status ?? canonicalRunStatusFromLegacy(params.legacyStatus);
  return {
    projectionVersion: CHAT_PROJECTION_VERSION,
    semanticType: params.semanticType,
    sessionKey: params.sessionKey,
    ...(params.run ? {
      runId: params.run.runId,
      gatewayRunId: params.run.gatewayRunId,
      clientMessageId: params.run.clientMessageId,
      idempotencyKey: params.run.idempotencyKey,
      runStatus: params.run.status,
      status: params.run.status,
      statusLabel: runStatusLabel(params.run.status, params.run, params.legacyStatusLabel),
      activeRun: activeRunProjection(params.run),
    } : {
      runStatus: status,
      status: legacySessionStatusFromRunStatus(status),
      statusLabel: runStatusLabel(status, null, params.legacyStatusLabel),
      activeRun: null,
    }),
    ...(params.messageId ? { messageId: params.messageId } : {}),
    ...(params.tool ? { toolCallId: params.tool.toolCallId, toolCall: toolCallProjection(params.tool) } : {}),
    ...(params.payload ?? {}),
  };
}

export function buildChatBootstrapSnapshot(context: AppContext, params: {
  sessionKey: string;
  sessionId: string | null;
  sessionData: Record<string, unknown>;
  messages: unknown[];
  messageCount: number;
  cursor: number;
  projection: { upserted: number; lastSeq: number; liveSubscribed: boolean };
  historyMeta?: { thinkingLevel?: unknown; fastMode?: unknown; verboseLevel?: unknown };
}) {
  const activeRun = context.runs.findLatestPendingRun(params.sessionKey);
  const latestRun = activeRun ?? context.runs.latestRun(params.sessionKey);
  const runStatus = latestRun?.status ?? canonicalRunStatusFromLegacy(params.sessionData.status);
  const statusLabel = runStatusLabel(runStatus, latestRun, params.sessionData.statusLabel);
  const tools = context.runs.listToolCalls(params.sessionKey).map(toolCallProjection);
  const sessionStatus = typeof params.sessionData.status === "string"
    ? params.sessionData.status
    : legacySessionStatusFromRunStatus(runStatus);

  return {
    ok: true,
    source: "middleware-v2-projection",
    projectionVersion: CHAT_PROJECTION_VERSION,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    runStatus,
    statusLabel,
    activeRun: activeRunProjection(activeRun),
    messages: params.messages,
    messageCount: params.messageCount,
    tools,
    toolCalls: tools,
    cursor: params.cursor,
    sessionStatus,
    thinkingLevel: params.historyMeta?.thinkingLevel,
    fastMode: params.historyMeta?.fastMode,
    verboseLevel: params.historyMeta?.verboseLevel,
    projection: {
      enabled: true,
      version: CHAT_PROJECTION_VERSION,
      upserted: params.projection.upserted,
      lastSeq: params.projection.lastSeq,
      cursor: params.cursor,
      liveSubscribed: params.projection.liveSubscribed,
    },
  };
}
