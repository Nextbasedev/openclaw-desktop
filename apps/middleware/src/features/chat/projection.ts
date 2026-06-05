import type { AppContext } from "../../app.js";
import { CHAT_PROJECTION_VERSION } from "../../db/chat-projection-version.js";
import { normalizePatchSemanticType } from "./message-semantics.js";
import type { ProjectedRun, ProjectedToolCall, RunStatus } from "./repo.runs.js";

export { CHAT_PROJECTION_VERSION };

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
  // Legacy session rows can retain "Thinking" after the canonical run has
  // already finalized. Do not let that stale label resurrect active-looking UI
  // for terminal bootstraps/duplicate tabs.
  if (["queued", "thinking", "streaming", "tool_running", "error"].includes(status) && typeof legacyLabel === "string" && legacyLabel.trim()) return legacyLabel;
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

function isAwaitingToolResultMeta(value: unknown) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).awaitingResult === true);
}

function previewJson(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  try {
    return JSON.stringify(value).slice(0, 200);
  } catch {
    return String(value).slice(0, 200);
  }
}

export function toolCallProjection(tool: ProjectedToolCall, options: { includeDetails?: boolean } = {}) {
  const awaitingResult = isAwaitingToolResultMeta(tool.resultMeta);
  const base = {
    toolCallId: tool.toolCallId,
    id: tool.toolCallId,
    sessionKey: tool.sessionKey,
    runId: tool.runId,
    messageId: tool.messageId,
    name: tool.name,
    phase: tool.phase,
    status: tool.status,
    ...(awaitingResult ? { awaitingResult: true, resultSource: "gateway_stripped_live_result" } : {}),
    startedAtMs: tool.startedAtMs,
    finishedAtMs: tool.finishedAtMs,
    updatedAtMs: tool.updatedAtMs,
  };
  if (options.includeDetails) return { ...base, argsMeta: tool.argsMeta, resultMeta: tool.resultMeta };
  return {
    ...base,
    detailTruncated: true,
    ...(tool.argsMeta !== undefined && tool.argsMeta !== null ? { argsPreview: previewJson(tool.argsMeta) } : {}),
    ...(tool.resultMeta !== undefined && tool.resultMeta !== null ? { resultPreview: previewJson(tool.resultMeta) } : {}),
  };
}

const SUBAGENT_TOOL_NAMES = new Set(["sessions_spawn", "subagents", "sessions_yield"]);

export function bootstrapToolProjection(tool: ProjectedToolCall) {
  return {
    toolCallId: tool.toolCallId,
    id: tool.toolCallId,
    name: tool.name,
    status: tool.status,
    phase: tool.phase,
    messageId: tool.messageId,
    startedAtMs: tool.startedAtMs,
    finishedAtMs: tool.finishedAtMs,
  };
}

function bootstrapTools(rawTools: ProjectedToolCall[], latestRun: ProjectedRun | null) {
  return rawTools
    .filter((tool) => (latestRun !== null && tool.runId === latestRun.runId) || SUBAGENT_TOOL_NAMES.has(tool.name))
    .map(bootstrapToolProjection);
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
  const semanticType = normalizePatchSemanticType(params.semanticType, params.payload);
  return {
    projectionVersion: CHAT_PROJECTION_VERSION,
    semanticType,
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
    ...(params.tool ? { toolCallId: params.tool.toolCallId, toolCall: toolCallProjection(params.tool, { includeDetails: true }) } : {}),
    ...(params.payload ?? {}),
  };
}

export function buildChatBootstrapSnapshot(context: AppContext, params: {
  sessionKey: string;
  sessionId: string | null;
  sessionData: Record<string, unknown>;
  messages: unknown[];
  messageCount: number;
  knownTotalMessages?: number;
  knownVisibleTotal?: number;
  oldestVisibleSeq?: number | null;
  oldestLoadedSeq?: number;
  cursor: number;
  projection: { upserted: number; lastSeq: number; liveSubscribed: boolean };
  historyMeta?: { thinkingLevel?: unknown; fastMode?: unknown; verboseLevel?: unknown };
}) {
  const activeRun = context.runs.findLatestPendingRun(params.sessionKey);
  const latestRun = activeRun ?? context.runs.latestRun(params.sessionKey);
  const runStatus = latestRun?.status ?? canonicalRunStatusFromLegacy(params.sessionData.status);
  const statusLabel = runStatusLabel(runStatus, latestRun, params.sessionData.statusLabel);
  const rawTools = context.runs.listToolCalls(params.sessionKey);
  const tools = bootstrapTools(rawTools, latestRun);
  const sessionStatus = legacySessionStatusFromRunStatus(runStatus);
  const knownVisibleTotal = params.knownVisibleTotal ?? params.knownTotalMessages ?? params.messageCount;
  const oldestVisibleSeq = params.oldestVisibleSeq ?? null;
  const oldestLoadedSeq = params.oldestLoadedSeq ?? null;
  const hasOlder = typeof oldestLoadedSeq === "number" && typeof oldestVisibleSeq === "number"
    ? oldestLoadedSeq > oldestVisibleSeq
    : false;

  return {
    ok: true,
    source: "middleware-projection",
    projectionVersion: CHAT_PROJECTION_VERSION,
    sessionKey: params.sessionKey,
    sessionId: params.sessionId,
    runStatus,
    statusLabel,
    activeRun: activeRunProjection(activeRun),
    historyCoverage: hasOlder ? "windowed" : "full",
    fullMessagesIncluded: !hasOlder,
    hasOlder,
    knownTotalMessages: params.knownTotalMessages ?? params.messageCount,
    knownVisibleTotal,
    oldestVisibleSeq,
    oldestLoadedSeq,
    messages: params.messages,
    messageCount: params.messageCount,
    tools,
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
