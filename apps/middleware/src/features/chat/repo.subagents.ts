import type Database from "better-sqlite3";

export type SubagentStatus = "spawning" | "linking" | "working" | "completed" | "failed";

export type ProjectedSubagent = {
  parentSessionKey: string;
  toolCallId: string;
  childSessionKey: string | null;
  label: string;
  status: SubagentStatus;
  createdAtMs: number;
  updatedAtMs: number;
};

function rowToSubagent(row: Record<string, unknown>): ProjectedSubagent {
  return {
    parentSessionKey: String(row.parent_session_key),
    toolCallId: String(row.tool_call_id),
    childSessionKey: typeof row.child_session_key === "string" ? row.child_session_key : null,
    label: typeof row.label === "string" && row.label.trim() ? row.label : "Sub-agent",
    status: String(row.status ?? "spawning") as SubagentStatus,
    createdAtMs: Number(row.created_at_ms ?? 0),
    updatedAtMs: Number(row.updated_at_ms ?? 0),
  };
}

export class SubagentRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(input: {
    parentSessionKey: string;
    toolCallId: string;
    childSessionKey?: string | null;
    label?: string | null;
    status?: SubagentStatus;
    nowMs?: number;
  }): ProjectedSubagent {
    const nowMs = input.nowMs ?? Date.now();
    const label = input.label?.trim() || "Sub-agent";
    const status = input.status ?? "spawning";
    this.db.prepare(`
      INSERT INTO v2_subagents(parent_session_key, tool_call_id, child_session_key, label, status, created_at_ms, updated_at_ms)
      VALUES (@parentSessionKey, @toolCallId, @childSessionKey, @label, @status, @nowMs, @nowMs)
      ON CONFLICT(parent_session_key, tool_call_id) DO UPDATE SET
        child_session_key = COALESCE(excluded.child_session_key, v2_subagents.child_session_key),
        label = COALESCE(NULLIF(excluded.label, 'Sub-agent'), v2_subagents.label, excluded.label),
        status = excluded.status,
        updated_at_ms = excluded.updated_at_ms
    `).run({
      parentSessionKey: input.parentSessionKey,
      toolCallId: input.toolCallId,
      childSessionKey: input.childSessionKey ?? null,
      label,
      status,
      nowMs,
    });
    return this.get(input.parentSessionKey, input.toolCallId)!;
  }

  get(parentSessionKey: string, toolCallId: string): ProjectedSubagent | null {
    const row = this.db.prepare(`
      SELECT * FROM v2_subagents
      WHERE parent_session_key = @parentSessionKey AND tool_call_id = @toolCallId
    `).get({ parentSessionKey, toolCallId }) as Record<string, unknown> | undefined;
    return row ? rowToSubagent(row) : null;
  }

  findByChildSessionKey(childSessionKey: string): ProjectedSubagent | null {
    const row = this.db.prepare(`
      SELECT * FROM v2_subagents
      WHERE child_session_key = @childSessionKey
      ORDER BY updated_at_ms DESC
      LIMIT 1
    `).get({ childSessionKey }) as Record<string, unknown> | undefined;
    return row ? rowToSubagent(row) : null;
  }

  listForParent(parentSessionKey: string): ProjectedSubagent[] {
    const rows = this.db.prepare(`
      SELECT * FROM v2_subagents
      WHERE parent_session_key = @parentSessionKey
      ORDER BY created_at_ms ASC, tool_call_id ASC
    `).all({ parentSessionKey }) as Record<string, unknown>[];
    return rows.map(rowToSubagent);
  }
}
