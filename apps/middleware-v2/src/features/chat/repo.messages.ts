import type Database from "better-sqlite3";
import { fromJson, toJson } from "../../db/json.js";
import type { ProjectedMessage, ProjectionEvent } from "./types.js";

function normalizeText(value: string) {
  return value
    .replace(/^Sender \(untrusted metadata\):\s*```(?:json)?\s*[\s\S]*?```\s*/i, "")
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:UTC|GMT[+-]\d{1,2}:?\d{2})\]\s*/i, "")
    .replace(/\n\n\[Bootstrap truncation warning\][\s\S]*$/i, "")
    .trim()
    .replace(/\s+/g, " ");
}

function textOf(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const maybe = data as { text?: unknown; content?: unknown };
  if (typeof maybe.text === "string") return normalizeText(maybe.text);
  if (typeof maybe.content === "string") return normalizeText(maybe.content);
  if (Array.isArray(maybe.content)) {
    return normalizeText(maybe.content.map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && !Array.isArray(block)) {
        const text = (block as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    }).join(""));
  }
  return "";
}

function isOptimisticData(data: unknown) {
  return Boolean(data && typeof data === "object" && !Array.isArray(data) && (data as { __clientOptimistic?: unknown }).__clientOptimistic);
}

function isOptimisticConflict(existing: { message_id: string | null; role: string | null; data_json: string }, incoming: ProjectedMessage) {
  const existingData = fromJson(existing.data_json);
  if (!isOptimisticData(existingData)) return false;
  if (existing.message_id && incoming.messageId && existing.message_id === incoming.messageId) return false;
  if (existing.role === "user" && incoming.role === "user" && textOf(existingData) === textOf(incoming.data)) return false;
  return true;
}

export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  getSession(sessionKey: string): { sessionKey: string; sessionId: string | null; data: unknown; updatedAtMs: number } | null {
    const row = this.db.prepare(`
      SELECT session_key, session_id, data_json, updated_at_ms
      FROM v2_sessions
      WHERE session_key = @sessionKey
    `).get({ sessionKey }) as { session_key: string; session_id: string | null; data_json: string; updated_at_ms: number } | undefined;
    if (!row) return null;
    return { sessionKey: row.session_key, sessionId: row.session_id, data: fromJson(row.data_json), updatedAtMs: row.updated_at_ms };
  }

  upsertSession(session: { sessionKey: string; sessionId?: string | null; data: unknown; updatedAtMs?: number }) {
    this.db.prepare(`
      INSERT INTO v2_sessions(session_key, session_id, data_json, updated_at_ms)
      VALUES (@sessionKey, @sessionId, @dataJson, @updatedAtMs)
      ON CONFLICT(session_key) DO UPDATE SET
        session_id = excluded.session_id,
        data_json = excluded.data_json,
        updated_at_ms = excluded.updated_at_ms
    `).run({
      sessionKey: session.sessionKey,
      sessionId: session.sessionId ?? null,
      dataJson: toJson(session.data),
      updatedAtMs: session.updatedAtMs ?? Date.now(),
    });
  }

  upsertMessages(messages: ProjectedMessage[]) {
    if (messages.length === 0) return { upserted: 0, lastSeq: 0 };
    const insert = this.db.prepare(`
      INSERT INTO v2_messages(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms)
      VALUES (@sessionKey, @openclawSeq, @messageId, @role, @dataJson, @updatedAtMs)
      ON CONFLICT(session_key, openclaw_seq) DO UPDATE SET
        message_id = excluded.message_id,
        role = excluded.role,
        data_json = excluded.data_json,
        updated_at_ms = excluded.updated_at_ms
    `);
    const existingAtSeq = this.db.prepare(`
      SELECT message_id, role, data_json
      FROM v2_messages
      WHERE session_key = @sessionKey AND openclaw_seq = @openclawSeq
    `);
    const maxSeq = this.db.prepare(`
      SELECT max(openclaw_seq) AS maxSeq
      FROM v2_messages
      WHERE session_key = @sessionKey
    `);
    const offset = this.db.prepare(`
      INSERT INTO v2_gateway_offsets(session_key, last_openclaw_seq, updated_at_ms)
      VALUES (@sessionKey, @lastSeq, @updatedAtMs)
      ON CONFLICT(session_key) DO UPDATE SET
        last_openclaw_seq = max(v2_gateway_offsets.last_openclaw_seq, excluded.last_openclaw_seq),
        updated_at_ms = excluded.updated_at_ms
    `);
    const tx = this.db.transaction((rows: ProjectedMessage[]) => {
      let lastSeq = 0;
      for (const message of rows) {
        let openclawSeq = message.openclawSeq;
        const existing = existingAtSeq.get({
          sessionKey: message.sessionKey,
          openclawSeq: message.openclawSeq,
        }) as { message_id: string | null; role: string | null; data_json: string } | undefined;
        if (existing && isOptimisticConflict(existing, message)) {
          const row = maxSeq.get({ sessionKey: message.sessionKey }) as { maxSeq?: number | null } | undefined;
          openclawSeq = Math.max(message.openclawSeq, Number(row?.maxSeq ?? 0)) + 1;
        }
        insert.run({
          sessionKey: message.sessionKey,
          openclawSeq,
          messageId: message.messageId,
          role: message.role,
          dataJson: toJson(message.data),
          updatedAtMs: message.updatedAtMs,
        });
        lastSeq = Math.max(lastSeq, message.openclawSeq);
      }
      offset.run({ sessionKey: rows[0]?.sessionKey, lastSeq, updatedAtMs: Date.now() });
      return lastSeq;
    });
    const lastSeq = tx(messages) as number;
    return { upserted: messages.length, lastSeq };
  }

  nextMessageSeq(sessionKey: string): number {
    const row = this.db.prepare(`
      SELECT max(openclaw_seq) AS maxSeq
      FROM v2_messages
      WHERE session_key = @sessionKey
    `).get({ sessionKey }) as { maxSeq?: number | null } | undefined;
    return Math.max(0, Number(row?.maxSeq ?? 0)) + 1;
  }

  insertOptimisticMessage(message: ProjectedMessage) {
    this.db.prepare(`
      INSERT INTO v2_messages(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms)
      VALUES (@sessionKey, @openclawSeq, @messageId, @role, @dataJson, @updatedAtMs)
      ON CONFLICT(session_key, openclaw_seq) DO UPDATE SET
        message_id = excluded.message_id,
        role = excluded.role,
        data_json = excluded.data_json,
        updated_at_ms = excluded.updated_at_ms
    `).run({
      sessionKey: message.sessionKey,
      openclawSeq: message.openclawSeq,
      messageId: message.messageId,
      role: message.role,
      dataJson: toJson(message.data),
      updatedAtMs: message.updatedAtMs,
    });
  }

  deleteMessageById(sessionKey: string, messageId: string) {
    return this.db.prepare(`
      DELETE FROM v2_messages
      WHERE session_key = @sessionKey AND message_id = @messageId
    `).run({ sessionKey, messageId }).changes;
  }

  appendProjectionEvent(params: { sessionKey?: string | null; eventType: string; payload: unknown; createdAtMs?: number }): ProjectionEvent {
    const createdAtMs = params.createdAtMs ?? Date.now();
    const info = this.db.prepare(`
      INSERT INTO v2_projection_events(session_key, event_type, payload_json, created_at_ms)
      VALUES (@sessionKey, @eventType, @payloadJson, @createdAtMs)
    `).run({
      sessionKey: params.sessionKey ?? null,
      eventType: params.eventType,
      payloadJson: toJson(params.payload),
      createdAtMs,
    });
    return {
      cursor: Number(info.lastInsertRowid),
      sessionKey: params.sessionKey ?? null,
      eventType: params.eventType,
      payload: params.payload,
      createdAtMs,
    };
  }

  listMessages(sessionKey: string, opts: { afterSeq?: number; limit?: number } = {}): ProjectedMessage[] {
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 200));
    const rows = this.db.prepare(`
      SELECT session_key, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM v2_messages
      WHERE session_key = @sessionKey AND openclaw_seq > @afterSeq
      ORDER BY openclaw_seq ASC
      LIMIT @limit
    `).all({ sessionKey, afterSeq: opts.afterSeq ?? 0, limit }) as Array<{
      session_key: string;
      openclaw_seq: number;
      message_id: string | null;
      role: string | null;
      data_json: string;
      updated_at_ms: number;
    }>;
    return rows.map((row) => ({
      sessionKey: row.session_key,
      openclawSeq: row.openclaw_seq,
      messageId: row.message_id,
      role: row.role,
      data: fromJson(row.data_json),
      updatedAtMs: row.updated_at_ms,
    }));
  }

  diagnostics() {
    return this.db.prepare(`
      SELECT
        (SELECT count(*) FROM v2_sessions) AS sessions,
        (SELECT count(*) FROM v2_messages) AS messages,
        (SELECT count(*) FROM v2_projection_events) AS projectionEvents,
        (SELECT max(cursor) FROM v2_projection_events) AS latestCursor
    `).get() as { sessions: number; messages: number; projectionEvents: number; latestCursor: number | null };
  }
}
