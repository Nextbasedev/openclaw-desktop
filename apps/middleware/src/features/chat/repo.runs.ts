import type Database from "better-sqlite3";
import { fromJson, toJson } from "../../db/json.js";

export type RunStatus = "queued" | "thinking" | "streaming" | "tool_running" | "done" | "error" | "aborted";
export type ToolPhase = "start" | "calling" | "update" | "result" | "error";
export type ToolStatus = "running" | "success" | "error";

const STALE_DETACHED_TOOL_MS = 5 * 60 * 1000;
const DEFAULT_STALE_ACTIVE_RUN_MS = 10 * 60 * 1000;
const DEFAULT_STALE_RUNNING_TOOL_MS = 30 * 60 * 1000;

export type ProjectedRun = {
  runId: string;
  sessionKey: string;
  clientMessageId: string | null;
  idempotencyKey: string | null;
  gatewayRunId: string | null;
  status: RunStatus;
  statusLabel: string | null;
  startedAtMs: number;
  finishedAtMs: number | null;
  error: unknown;
  updatedAtMs: number;
};

export type ProjectedToolCall = {
  toolCallId: string;
  sessionKey: string;
  runId: string | null;
  messageId: string | null;
  name: string;
  phase: ToolPhase;
  status: ToolStatus;
  argsMeta: unknown;
  resultMeta: unknown;
  startedAtMs: number;
  finishedAtMs: number | null;
  updatedAtMs: number;
};

function rowToRun(row: Record<string, unknown>): ProjectedRun {
  return {
    runId: String(row.run_id),
    sessionKey: String(row.session_key),
    clientMessageId: typeof row.client_message_id === "string" ? row.client_message_id : null,
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
    gatewayRunId: typeof row.gateway_run_id === "string" ? row.gateway_run_id : null,
    status: row.status as RunStatus,
    statusLabel: typeof row.status_label === "string" ? row.status_label : null,
    startedAtMs: Number(row.started_at_ms),
    finishedAtMs: typeof row.finished_at_ms === "number" ? row.finished_at_ms : null,
    error: typeof row.error_json === "string" ? fromJson(row.error_json) : null,
    updatedAtMs: Number(row.updated_at_ms),
  };
}

function rowToTool(row: Record<string, unknown>): ProjectedToolCall {
  return {
    toolCallId: String(row.tool_call_id),
    sessionKey: String(row.session_key),
    runId: typeof row.run_id === "string" ? row.run_id : null,
    messageId: typeof row.message_id === "string" ? row.message_id : null,
    name: String(row.name ?? "unknown"),
    phase: row.phase as ToolPhase,
    status: row.status as ToolStatus,
    argsMeta: typeof row.args_meta_json === "string" ? fromJson(row.args_meta_json) : null,
    resultMeta: typeof row.result_meta_json === "string" ? fromJson(row.result_meta_json) : null,
    startedAtMs: Number(row.started_at_ms),
    finishedAtMs: typeof row.finished_at_ms === "number" ? row.finished_at_ms : null,
    updatedAtMs: Number(row.updated_at_ms),
  };
}

export class RunRepository {
  constructor(private readonly db: Database.Database) {}

  upsertRun(run: {
    runId: string;
    sessionKey: string;
    clientMessageId?: string | null;
    idempotencyKey?: string | null;
    gatewayRunId?: string | null;
    status: RunStatus;
    statusLabel?: string | null;
    startedAtMs?: number;
    finishedAtMs?: number | null;
    error?: unknown;
    updatedAtMs?: number;
  }): ProjectedRun {
    const now = run.updatedAtMs ?? Date.now();
    const startedAtMs = run.startedAtMs ?? now;
    this.db.prepare(`
      INSERT INTO v2_runs(run_id, session_key, client_message_id, idempotency_key, gateway_run_id, status, status_label, started_at_ms, finished_at_ms, error_json, updated_at_ms)
      VALUES (@runId, @sessionKey, @clientMessageId, @idempotencyKey, @gatewayRunId, @status, @statusLabel, @startedAtMs, @finishedAtMs, @errorJson, @updatedAtMs)
      ON CONFLICT(run_id) DO UPDATE SET
        session_key = excluded.session_key,
        client_message_id = COALESCE(excluded.client_message_id, v2_runs.client_message_id),
        idempotency_key = COALESCE(excluded.idempotency_key, v2_runs.idempotency_key),
        gateway_run_id = COALESCE(excluded.gateway_run_id, v2_runs.gateway_run_id),
        status = CASE WHEN v2_runs.status IN ('done','error','aborted') THEN v2_runs.status ELSE excluded.status END,
        status_label = CASE WHEN v2_runs.status IN ('done','error','aborted') THEN v2_runs.status_label ELSE excluded.status_label END,
        finished_at_ms = COALESCE(v2_runs.finished_at_ms, excluded.finished_at_ms),
        error_json = COALESCE(v2_runs.error_json, excluded.error_json),
        updated_at_ms = excluded.updated_at_ms
    `).run({
      runId: run.runId,
      sessionKey: run.sessionKey,
      clientMessageId: run.clientMessageId ?? null,
      idempotencyKey: run.idempotencyKey ?? null,
      gatewayRunId: run.gatewayRunId ?? null,
      status: run.status,
      statusLabel: run.statusLabel ?? null,
      startedAtMs,
      finishedAtMs: run.finishedAtMs ?? null,
      errorJson: run.error === undefined || run.error === null ? null : toJson(run.error),
      updatedAtMs: now,
    });
    return this.getRun(run.runId)!;
  }

  updateRunStatus(runId: string, status: RunStatus, params: { statusLabel?: string | null; error?: unknown; finishedAtMs?: number | null; updatedAtMs?: number } = {}) {
    const existing = this.getRun(runId);
    if (existing && ["done", "error", "aborted"].includes(existing.status) && !["done", "error", "aborted"].includes(status)) return existing;
    const now = params.updatedAtMs ?? Date.now();
    const finishedAtMs = params.finishedAtMs ?? (["done", "error", "aborted"].includes(status) ? now : null);
    this.db.prepare(`
      UPDATE v2_runs
      SET status = @status, status_label = @statusLabel, finished_at_ms = @finishedAtMs, error_json = @errorJson, updated_at_ms = @updatedAtMs
      WHERE run_id = @runId
    `).run({
      runId,
      status,
      statusLabel: params.statusLabel ?? null,
      finishedAtMs,
      errorJson: params.error === undefined || params.error === null ? null : toJson(params.error),
      updatedAtMs: now,
    });
    return this.getRun(runId);
  }

  getRun(runId: string): ProjectedRun | null {
    const row = this.db.prepare(`SELECT * FROM v2_runs WHERE run_id = @runId`).get({ runId }) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  findRunByGatewayRunId(gatewayRunId: string): ProjectedRun | null {
    const row = this.db.prepare(`SELECT * FROM v2_runs WHERE gateway_run_id = @gatewayRunId ORDER BY started_at_ms DESC LIMIT 1`).get({ gatewayRunId }) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  findRunByClientMessage(sessionKey: string, clientMessageId: string): ProjectedRun | null {
    const row = this.db.prepare(`SELECT * FROM v2_runs WHERE session_key = @sessionKey AND client_message_id = @clientMessageId ORDER BY started_at_ms DESC LIMIT 1`).get({ sessionKey, clientMessageId }) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  findRunByIdempotencyKey(sessionKey: string, idempotencyKey: string): ProjectedRun | null {
    const row = this.db.prepare(`SELECT * FROM v2_runs WHERE session_key = @sessionKey AND idempotency_key = @idempotencyKey ORDER BY started_at_ms DESC LIMIT 1`).get({ sessionKey, idempotencyKey }) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  findLatestPendingRun(sessionKey: string): ProjectedRun | null {
    const row = this.db.prepare(`
      SELECT * FROM v2_runs
      WHERE session_key = @sessionKey AND status IN ('queued', 'thinking', 'streaming', 'tool_running')
      ORDER BY started_at_ms DESC
      LIMIT 1
    `).get({ sessionKey }) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  latestRun(sessionKey: string): ProjectedRun | null {
    const row = this.db.prepare(`SELECT * FROM v2_runs WHERE session_key = @sessionKey ORDER BY updated_at_ms DESC LIMIT 1`).get({ sessionKey }) as Record<string, unknown> | undefined;
    return row ? rowToRun(row) : null;
  }

  upsertToolCall(tool: {
    toolCallId: string;
    sessionKey: string;
    runId?: string | null;
    messageId?: string | null;
    name?: string | null;
    phase: ToolPhase;
    status?: ToolStatus;
    argsMeta?: unknown;
    resultMeta?: unknown;
    startedAtMs?: number;
    finishedAtMs?: number | null;
    updatedAtMs?: number;
  }): ProjectedToolCall {
    const existing = this.getToolCall(tool.sessionKey, tool.toolCallId);
    const incomingStatus = tool.status ?? (tool.phase === "error" ? "error" : tool.phase === "result" ? "success" : "running");
    const now = tool.updatedAtMs ?? Date.now();
    // Historical assistant/tool events can be replayed after a refresh. If a tool
    // already reached a terminal state, a replayed toolCall block must not
    // resurrect it as running. Explicit result/error events may still enrich it.
    if (existing && existing.status !== "running" && incomingStatus === "running") return existing;
    // A replayed detached tool start can arrive while a fresh run is active. Do
    // not attach that old tool to the new run; this was the source of stale
    // visible "web_fetch" tool calls after restart/backlog replay.
    if (
      existing &&
      existing.status === "running" &&
      !existing.runId &&
      tool.runId &&
      incomingStatus === "running" &&
      now - existing.startedAtMs > STALE_DETACHED_TOOL_MS
    ) return existing;
    const status = incomingStatus;
    const finishedAtMs = tool.finishedAtMs ?? (status === "running" ? null : now);
    const runId = existing?.runId ?? tool.runId ?? null;
    this.db.prepare(`
      INSERT INTO v2_tool_calls(tool_call_id, session_key, run_id, message_id, name, phase, status, args_meta_json, result_meta_json, started_at_ms, finished_at_ms, updated_at_ms)
      VALUES (@toolCallId, @sessionKey, @runId, @messageId, @name, @phase, @status, @argsMetaJson, @resultMetaJson, @startedAtMs, @finishedAtMs, @updatedAtMs)
      ON CONFLICT(session_key, tool_call_id) DO UPDATE SET
        run_id = COALESCE(excluded.run_id, v2_tool_calls.run_id),
        message_id = COALESCE(excluded.message_id, v2_tool_calls.message_id),
        name = COALESCE(NULLIF(excluded.name, 'unknown'), v2_tool_calls.name),
        phase = excluded.phase,
        status = excluded.status,
        args_meta_json = COALESCE(excluded.args_meta_json, v2_tool_calls.args_meta_json),
        result_meta_json = COALESCE(excluded.result_meta_json, v2_tool_calls.result_meta_json),
        finished_at_ms = excluded.finished_at_ms,
        updated_at_ms = excluded.updated_at_ms
    `).run({
      toolCallId: tool.toolCallId,
      sessionKey: tool.sessionKey,
      runId,
      messageId: tool.messageId ?? null,
      name: tool.name ?? "unknown",
      phase: tool.phase,
      status,
      argsMetaJson: tool.argsMeta === undefined || tool.argsMeta === null ? null : toJson(tool.argsMeta),
      resultMetaJson: tool.resultMeta === undefined || tool.resultMeta === null ? null : toJson(tool.resultMeta),
      startedAtMs: tool.startedAtMs ?? now,
      finishedAtMs,
      updatedAtMs: now,
    });
    return this.getToolCall(tool.sessionKey, tool.toolCallId)!;
  }

  listRunningToolCalls(sessionKey: string, runId: string): ProjectedToolCall[] {
    const rows = this.db.prepare(`
      SELECT * FROM v2_tool_calls
      WHERE session_key = @sessionKey AND run_id = @runId AND status = 'running'
      ORDER BY started_at_ms ASC
    `).all({ sessionKey, runId });
    return (rows as Record<string, unknown>[]).map(rowToTool);
  }

  completeRunningTools(sessionKey: string, runId: string, params: { status?: Extract<ToolStatus, "success" | "error">; resultMeta?: unknown; updatedAtMs?: number } = {}): number {
    const now = params.updatedAtMs ?? Date.now();
    const status = params.status ?? "success";
    const resultMetaJson = params.resultMeta === undefined || params.resultMeta === null ? null : toJson(params.resultMeta);
    const result = this.db.prepare(`
      UPDATE v2_tool_calls
      SET status = @status,
          phase = CASE WHEN @status = 'error' THEN 'error' ELSE 'result' END,
          result_meta_json = COALESCE(@resultMetaJson, result_meta_json),
          finished_at_ms = COALESCE(finished_at_ms, @finishedAtMs),
          updated_at_ms = @updatedAtMs
      WHERE session_key = @sessionKey AND run_id = @runId AND status = 'running'
    `).run({
      sessionKey,
      runId,
      status,
      resultMetaJson,
      finishedAtMs: now,
      updatedAtMs: now,
    });
    return Number(result.changes ?? 0);
  }

  completeRunningToolsStartedBefore(sessionKey: string, runId: string, startedBeforeMs: number, params: { status?: Extract<ToolStatus, "success" | "error">; resultMeta?: unknown; updatedAtMs?: number } = {}): number {
    const now = params.updatedAtMs ?? Date.now();
    const status = params.status ?? "success";
    const resultMetaJson = params.resultMeta === undefined || params.resultMeta === null ? null : toJson(params.resultMeta);
    const result = this.db.prepare(`
      UPDATE v2_tool_calls
      SET status = @status,
          phase = CASE WHEN @status = 'error' THEN 'error' ELSE 'result' END,
          result_meta_json = COALESCE(@resultMetaJson, result_meta_json),
          finished_at_ms = COALESCE(finished_at_ms, @finishedAtMs),
          updated_at_ms = @updatedAtMs
      WHERE session_key = @sessionKey
        AND run_id = @runId
        AND status = 'running'
        AND started_at_ms < @startedBeforeMs
    `).run({
      sessionKey,
      runId,
      startedBeforeMs,
      status,
      resultMetaJson,
      finishedAtMs: now,
      updatedAtMs: now,
    });
    return Number(result.changes ?? 0);
  }

  getToolCall(sessionKey: string, toolCallId: string): ProjectedToolCall | null {
    const row = this.db.prepare(`SELECT * FROM v2_tool_calls WHERE session_key = @sessionKey AND tool_call_id = @toolCallId`).get({ sessionKey, toolCallId }) as Record<string, unknown> | undefined;
    return row ? rowToTool(row) : null;
  }

  listToolCalls(sessionKey: string, runId?: string): ProjectedToolCall[] {
    const rows = runId
      ? this.db.prepare(`SELECT * FROM v2_tool_calls WHERE session_key = @sessionKey AND run_id = @runId ORDER BY started_at_ms ASC`).all({ sessionKey, runId })
      : this.db.prepare(`SELECT * FROM v2_tool_calls WHERE session_key = @sessionKey ORDER BY started_at_ms ASC`).all({ sessionKey });
    return (rows as Record<string, unknown>[]).map(rowToTool);
  }

  hasRunningTools(sessionKey: string, runId: string): boolean {
    const row = this.db.prepare(`
      SELECT 1 FROM v2_tool_calls
      WHERE session_key = @sessionKey AND run_id = @runId AND status = 'running'
      LIMIT 1
    `).get({ sessionKey, runId }) as unknown;
    return Boolean(row);
  }

  finalizeStaleActivity(params: { nowMs?: number; activeRunMs?: number; runningToolMs?: number } = {}) {
    const now = params.nowMs ?? Date.now();
    const activeRunCutoff = now - (params.activeRunMs ?? DEFAULT_STALE_ACTIVE_RUN_MS);
    const runningToolCutoff = now - (params.runningToolMs ?? DEFAULT_STALE_RUNNING_TOOL_MS);

    const detachedTools = this.db.prepare(`
      UPDATE v2_tool_calls
      SET status = 'success', phase = 'result', finished_at_ms = COALESCE(finished_at_ms, @now), updated_at_ms = @now
      WHERE status = 'running'
        AND run_id IS NULL
        AND started_at_ms < @runningToolCutoff
    `).run({ now, runningToolCutoff });

    const staleTools = this.db.prepare(`
      UPDATE v2_tool_calls
      SET status = 'success', phase = 'result', finished_at_ms = COALESCE(finished_at_ms, @now), updated_at_ms = @now
      WHERE status = 'running'
        AND run_id IN (
          SELECT run_id FROM v2_runs
          WHERE status IN ('queued', 'thinking', 'streaming', 'tool_running', 'done', 'error', 'aborted')
            AND updated_at_ms < @activeRunCutoff
        )
        AND started_at_ms < @runningToolCutoff
    `).run({ now, activeRunCutoff, runningToolCutoff });

    const staleRuns = this.db.prepare(`
      UPDATE v2_runs
      SET status = 'done', status_label = NULL, finished_at_ms = COALESCE(finished_at_ms, @now), updated_at_ms = @now
      WHERE status IN ('queued', 'thinking', 'streaming', 'tool_running')
        AND updated_at_ms < @activeRunCutoff
        AND NOT EXISTS (
          SELECT 1 FROM v2_tool_calls
          WHERE v2_tool_calls.run_id = v2_runs.run_id
            AND v2_tool_calls.session_key = v2_runs.session_key
            AND v2_tool_calls.status = 'running'
        )
    `).run({ now, activeRunCutoff });

    return {
      runsFinalized: Number(staleRuns.changes ?? 0),
      detachedToolsFinalized: Number(detachedTools.changes ?? 0),
      toolsFinalized: Number(staleTools.changes ?? 0),
    };
  }

  diagnostics() {
    return this.db.prepare(`
      SELECT
        (SELECT count(*) FROM v2_runs) AS runs,
        (SELECT count(*) FROM v2_tool_calls) AS toolCalls
    `).get() as { runs: number; toolCalls: number };
  }
}
