import type Database from "better-sqlite3";
import { fromJson, toJson } from "../../db/json.js";
import { isInternalSubagentCompletionMessage, normalizeMessageText, textFromMessage } from "./message-normalizer.js";
import type { OpenClawMessage, ProjectedMessage, ProjectionEvent } from "./types.js";

function textOf(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  return normalizeMessageText(textFromMessage(data as OpenClawMessage));
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
    if (messages.length === 0) return { upserted: 0, lastSeq: 0, changedMessages: [] as ProjectedMessage[] };
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
    const existingById = this.db.prepare(`
      SELECT openclaw_seq
      FROM v2_messages
      WHERE session_key = @sessionKey AND message_id = @messageId
      LIMIT 1
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
      const changedMessages: ProjectedMessage[] = [];
      for (const message of rows) {
        let openclawSeq = message.openclawSeq;
        const idMatch = message.messageId
          ? existingById.get({ sessionKey: message.sessionKey, messageId: message.messageId }) as { openclaw_seq: number } | undefined
          : undefined;
        if (idMatch?.openclaw_seq) openclawSeq = idMatch.openclaw_seq;

        let existing = existingAtSeq.get({
          sessionKey: message.sessionKey,
          openclawSeq,
        }) as { message_id: string | null; role: string | null; data_json: string } | undefined;
        if (!idMatch && existing && isOptimisticConflict(existing, message)) {
          const row = maxSeq.get({ sessionKey: message.sessionKey }) as { maxSeq?: number | null } | undefined;
          openclawSeq = Math.max(message.openclawSeq, Number(row?.maxSeq ?? 0)) + 1;
          existing = existingAtSeq.get({ sessionKey: message.sessionKey, openclawSeq }) as typeof existing;
        }

        const dataJson = toJson(message.data);
        const changed = !existing || existing.message_id !== message.messageId || existing.role !== message.role || existing.data_json !== dataJson;
        const storedMessage = openclawSeq === message.openclawSeq ? message : { ...message, openclawSeq };
        if (changed) {
          insert.run({
            sessionKey: message.sessionKey,
            openclawSeq,
            messageId: message.messageId,
            role: message.role,
            dataJson,
            updatedAtMs: message.updatedAtMs,
          });
          changedMessages.push(storedMessage);
        }
        lastSeq = Math.max(lastSeq, openclawSeq);
      }
      offset.run({ sessionKey: rows[0]?.sessionKey, lastSeq, updatedAtMs: Date.now() });
      return { lastSeq, changedMessages };
    });
    const result = tx(messages) as { lastSeq: number; changedMessages: ProjectedMessage[] };
    return { upserted: result.changedMessages.length, lastSeq: result.lastSeq, changedMessages: result.changedMessages };
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

  confirmOptimisticUser(sessionKey: string, optimisticId: string, gatewayMessage: ProjectedMessage) {
    const existing = this.db.prepare(`
      SELECT openclaw_seq, data_json
      FROM v2_messages
      WHERE session_key = @sessionKey AND message_id = @optimisticId
      LIMIT 1
    `).get({ sessionKey, optimisticId }) as { openclaw_seq: number; data_json: string } | undefined;
    if (!existing) return null;

    if (gatewayMessage.messageId && gatewayMessage.messageId !== optimisticId) {
      this.db.prepare(`
        DELETE FROM v2_messages
        WHERE session_key = @sessionKey AND message_id = @gatewayMessageId
      `).run({ sessionKey, gatewayMessageId: gatewayMessage.messageId });
    }
    this.db.prepare(`
      DELETE FROM v2_messages
      WHERE session_key = @sessionKey AND openclaw_seq = @gatewaySeq AND message_id IS NOT @optimisticId
    `).run({ sessionKey, gatewaySeq: gatewayMessage.openclawSeq, optimisticId });

    const data = {
      ...gatewayMessage.data,
      isOptimistic: false,
      __clientOptimistic: false,
      __openclaw: {
        ...(gatewayMessage.data.__openclaw ?? {}),
        id: optimisticId,
        gatewayId: gatewayMessage.messageId,
        gatewaySeq: gatewayMessage.openclawSeq,
      },
    } as OpenClawMessage;
    const confirmed: ProjectedMessage = {
      ...gatewayMessage,
      openclawSeq: existing.openclaw_seq,
      messageId: optimisticId,
      data,
      updatedAtMs: gatewayMessage.updatedAtMs,
    };
    this.db.prepare(`
      UPDATE v2_messages
      SET role = @role, data_json = @dataJson, updated_at_ms = @updatedAtMs
      WHERE session_key = @sessionKey AND message_id = @optimisticId
    `).run({
      sessionKey,
      optimisticId,
      role: confirmed.role,
      dataJson: toJson(confirmed.data),
      updatedAtMs: confirmed.updatedAtMs,
    });
    return confirmed;
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

  listMessages(sessionKey: string, opts: { afterSeq?: number; beforeSeq?: number; limit?: number; latest?: boolean } = {}): ProjectedMessage[] {
    const limit = Math.max(1, Math.min(1000, opts.limit ?? 200));
    const beforeSeq = opts.beforeSeq ?? null;
    const rows = this.db.prepare(beforeSeq !== null ? `
      SELECT session_key, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM (
        SELECT session_key, openclaw_seq, message_id, role, data_json, updated_at_ms
        FROM v2_messages
        WHERE session_key = @sessionKey
          AND openclaw_seq > @afterSeq
          AND openclaw_seq < @beforeSeq
        ORDER BY openclaw_seq DESC
        LIMIT @limit
      )
      ORDER BY openclaw_seq ASC
    ` : opts.latest ? `
      SELECT session_key, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM (
        SELECT session_key, openclaw_seq, message_id, role, data_json, updated_at_ms
        FROM v2_messages
        WHERE session_key = @sessionKey AND openclaw_seq > @afterSeq
        ORDER BY openclaw_seq DESC
        LIMIT @limit
      )
      ORDER BY openclaw_seq ASC
    ` : `
      SELECT session_key, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM v2_messages
      WHERE session_key = @sessionKey AND openclaw_seq > @afterSeq
      ORDER BY openclaw_seq ASC
      LIMIT @limit
    `).all({ sessionKey, afterSeq: opts.afterSeq ?? 0, beforeSeq, limit }) as Array<{
      session_key: string;
      openclaw_seq: number;
      message_id: string | null;
      role: string | null;
      data_json: string;
      updated_at_ms: number;
    }>;
    return rows
      .map((row): ProjectedMessage => ({
        sessionKey: row.session_key,
        openclawSeq: row.openclaw_seq,
        messageId: row.message_id,
        role: row.role,
        data: fromJson(row.data_json) as OpenClawMessage,
        updatedAtMs: row.updated_at_ms,
      }))
      .filter((row) => !isInternalSubagentCompletionMessage(row.data));
  }

  listRecentSessionKeys(limit = 100): string[] {
    const rows = this.db.prepare(`
      SELECT session_key
      FROM v2_sessions
      ORDER BY updated_at_ms DESC
      LIMIT @limit
    `).all({ limit: Math.max(1, Math.min(500, Math.floor(limit))) }) as Array<{ session_key: string }>;
    return rows.map((row) => row.session_key).filter(Boolean);
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
