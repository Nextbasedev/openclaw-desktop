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

  getActiveSegment(sessionKey: string): { segmentId: string; sessionKey: string; sessionId: string | null; segmentIndex: number; baseSeq: number } | null {
    const row = this.db.prepare(`
      SELECT segment_id, session_key, session_id, segment_index, base_seq
      FROM v2_chat_segments
      WHERE session_key = @sessionKey AND is_active = 1
      ORDER BY segment_index DESC
      LIMIT 1
    `).get({ sessionKey }) as { segment_id: string; session_key: string; session_id: string | null; segment_index: number; base_seq: number } | undefined;
    if (!row) return null;
    return { segmentId: row.segment_id, sessionKey: row.session_key, sessionId: row.session_id, segmentIndex: row.segment_index, baseSeq: row.base_seq };
  }

  ensureActiveSegment(params: { sessionKey: string; sessionId?: string | null; sessionFile?: string | null; resetReason?: string | null }) {
    const sessionId = params.sessionId ?? null;
    const existing = this.getActiveSegment(params.sessionKey);
    if (existing && (!sessionId || existing.sessionId === sessionId)) return existing;
    if (existing && !existing.sessionId && sessionId) {
      const now = Date.now();
      this.db.prepare(`
        UPDATE v2_chat_segments
        SET session_id = @sessionId, session_file = COALESCE(@sessionFile, session_file), updated_at_ms = @now
        WHERE segment_id = @segmentId
      `).run({ segmentId: existing.segmentId, sessionId, sessionFile: params.sessionFile ?? null, now });
      return { ...existing, sessionId };
    }

    const now = Date.now();
    const maxSeqRow = this.db.prepare(`SELECT max(openclaw_seq) AS maxSeq FROM v2_messages WHERE session_key = @sessionKey`).get({ sessionKey: params.sessionKey }) as { maxSeq?: number | null } | undefined;
    const maxSegmentRow = this.db.prepare(`SELECT max(segment_index) AS maxIndex FROM v2_chat_segments WHERE session_key = @sessionKey`).get({ sessionKey: params.sessionKey }) as { maxIndex?: number | null } | undefined;
    const nextIndex = Math.max(-1, Number(maxSegmentRow?.maxIndex ?? -1)) + 1;
    const baseSeq = existing ? Math.max(0, Number(maxSeqRow?.maxSeq ?? 0)) : 0;
    const segmentId = `${params.sessionKey}::segment::${sessionId ?? "unknown"}::${nextIndex}`;
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE v2_chat_segments
        SET is_active = 0, ended_at_ms = COALESCE(ended_at_ms, @now), updated_at_ms = @now
        WHERE session_key = @sessionKey AND is_active = 1
      `).run({ sessionKey: params.sessionKey, now });
      this.db.prepare(`
        INSERT INTO v2_chat_segments(segment_id, session_key, session_id, session_file, segment_index, base_seq, started_at_ms, reset_reason, is_active, created_at_ms, updated_at_ms)
        VALUES (@segmentId, @sessionKey, @sessionId, @sessionFile, @segmentIndex, @baseSeq, @now, @resetReason, 1, @now, @now)
      `).run({
        segmentId,
        sessionKey: params.sessionKey,
        sessionId,
        sessionFile: params.sessionFile ?? null,
        segmentIndex: nextIndex,
        baseSeq,
        resetReason: params.resetReason ?? (existing ? "session_id_changed" : "initial"),
        now,
      });
    });
    tx();
    return { segmentId, sessionKey: params.sessionKey, sessionId, segmentIndex: nextIndex, baseSeq };
  }

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
    if (session.sessionId !== undefined) this.ensureActiveSegment({ sessionKey: session.sessionKey, sessionId: session.sessionId });
  }

  upsertMessages(messages: ProjectedMessage[], opts: { segmentId?: string | null; sessionId?: string | null; baseSeq?: number } = {}) {
    if (messages.length === 0) return { upserted: 0, lastSeq: 0, changedMessages: [] as ProjectedMessage[] };
    const insert = this.db.prepare(`
      INSERT INTO v2_messages(session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms)
      VALUES (@sessionKey, @segmentId, @sessionId, @gatewaySeq, @openclawSeq, @messageId, @role, @dataJson, @updatedAtMs)
      ON CONFLICT(session_key, openclaw_seq) DO UPDATE SET
        segment_id = COALESCE(excluded.segment_id, v2_messages.segment_id),
        session_id = COALESCE(excluded.session_id, v2_messages.session_id),
        gateway_seq = COALESCE(excluded.gateway_seq, v2_messages.gateway_seq),
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
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
      LIMIT 1
    `);
    const existingByGatewayId = this.db.prepare(`
      SELECT openclaw_seq
      FROM v2_messages
      WHERE session_key = @sessionKey
        AND json_extract(data_json, '$.__openclaw.gatewayId') = @messageId
      LIMIT 1
    `);
    const maxSeq = this.db.prepare(`
      SELECT max(openclaw_seq) AS maxSeq
      FROM v2_messages
      WHERE session_key = @sessionKey
    `);
    const moveSeq = this.db.prepare(`
      UPDATE v2_messages
      SET openclaw_seq = @newSeq
      WHERE session_key = @sessionKey AND openclaw_seq = @oldSeq
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
      const activeSegment = opts.segmentId
        ? this.getActiveSegment(rows[0]!.sessionKey)
        : this.ensureActiveSegment({ sessionKey: rows[0]!.sessionKey, sessionId: opts.sessionId ?? rows[0]!.sessionId ?? null });
      const resolvedSegmentId = opts.segmentId ?? activeSegment?.segmentId ?? null;
      const resolvedSessionId = opts.sessionId ?? activeSegment?.sessionId ?? rows[0]?.sessionId ?? null;
      const baseSeq = opts.baseSeq ?? activeSegment?.baseSeq ?? 0;
      for (const message of rows) {
        const gatewaySeq = message.gatewaySeq ?? message.openclawSeq;
        let openclawSeq = resolvedSegmentId ? baseSeq + gatewaySeq : message.openclawSeq;
        const segmentId = message.segmentId ?? resolvedSegmentId;
        const sessionId = message.sessionId ?? resolvedSessionId;
        const idMatch = message.messageId
          ? (existingById.get({ sessionKey: message.sessionKey, messageId: message.messageId, segmentId }) as { openclaw_seq: number } | undefined)
            ?? (existingByGatewayId.get({ sessionKey: message.sessionKey, messageId: message.messageId }) as { openclaw_seq: number } | undefined)
          : undefined;
        if (idMatch?.openclaw_seq) openclawSeq = idMatch.openclaw_seq;

        let existing = existingAtSeq.get({
          sessionKey: message.sessionKey,
          openclawSeq,
        }) as { message_id: string | null; role: string | null; data_json: string } | undefined;
        if (!idMatch && existing && isOptimisticConflict(existing, message)) {
          const row = maxSeq.get({ sessionKey: message.sessionKey }) as { maxSeq?: number | null } | undefined;
          const nextSeq = Math.max(openclawSeq, Number(row?.maxSeq ?? 0)) + 1;
          if (openclawSeq > 1 && existing.role === "user" && message.role === "assistant" && isOptimisticData(fromJson(existing.data_json))) {
            moveSeq.run({ sessionKey: message.sessionKey, oldSeq: openclawSeq, newSeq: nextSeq });
            existing = undefined;
          } else {
            openclawSeq = nextSeq;
            existing = existingAtSeq.get({ sessionKey: message.sessionKey, openclawSeq }) as typeof existing;
          }
        }

        const dataJson = toJson(message.data);
        const changed = !existing || existing.message_id !== message.messageId || existing.role !== message.role || existing.data_json !== dataJson;
        const storedMessage = openclawSeq === message.openclawSeq && !segmentId ? message : { ...message, segmentId, sessionId, gatewaySeq, openclawSeq };
        if (changed) {
          insert.run({
            sessionKey: message.sessionKey,
            segmentId,
            sessionId,
            gatewaySeq,
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
    const activeSegment = this.getActiveSegment(message.sessionKey);
    this.db.prepare(`
      INSERT INTO v2_messages(session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms)
      VALUES (@sessionKey, @segmentId, @sessionId, @gatewaySeq, @openclawSeq, @messageId, @role, @dataJson, @updatedAtMs)
      ON CONFLICT(session_key, openclaw_seq) DO UPDATE SET
        segment_id = COALESCE(excluded.segment_id, v2_messages.segment_id),
        session_id = COALESCE(excluded.session_id, v2_messages.session_id),
        gateway_seq = COALESCE(excluded.gateway_seq, v2_messages.gateway_seq),
        message_id = excluded.message_id,
        role = excluded.role,
        data_json = excluded.data_json,
        updated_at_ms = excluded.updated_at_ms
    `).run({
      sessionKey: message.sessionKey,
      segmentId: message.segmentId ?? activeSegment?.segmentId ?? null,
      sessionId: message.sessionId ?? activeSegment?.sessionId ?? null,
      gatewaySeq: message.gatewaySeq ?? null,
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
      SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM (
        SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
        FROM v2_messages
        WHERE session_key = @sessionKey
          AND openclaw_seq > @afterSeq
          AND openclaw_seq < @beforeSeq
        ORDER BY openclaw_seq DESC
        LIMIT @limit
      )
      ORDER BY openclaw_seq ASC
    ` : opts.latest ? `
      SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM (
        SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
        FROM v2_messages
        WHERE session_key = @sessionKey AND openclaw_seq > @afterSeq
        ORDER BY openclaw_seq DESC
        LIMIT @limit
      )
      ORDER BY openclaw_seq ASC
    ` : `
      SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM v2_messages
      WHERE session_key = @sessionKey AND openclaw_seq > @afterSeq
      ORDER BY openclaw_seq ASC
      LIMIT @limit
    `).all({ sessionKey, afterSeq: opts.afterSeq ?? 0, beforeSeq, limit }) as Array<{
      session_key: string;
      segment_id: string | null;
      session_id: string | null;
      gateway_seq: number | null;
      openclaw_seq: number;
      message_id: string | null;
      role: string | null;
      data_json: string;
      updated_at_ms: number;
    }>;
    return rows
      .map((row): ProjectedMessage => ({
        sessionKey: row.session_key,
        segmentId: row.segment_id,
        sessionId: row.session_id,
        gatewaySeq: row.gateway_seq,
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
