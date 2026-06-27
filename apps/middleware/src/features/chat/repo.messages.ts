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

function runIdentityOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const message = data as OpenClawMessage;
  const openclaw = message.__openclaw && typeof message.__openclaw === "object" ? message.__openclaw as Record<string, unknown> : {};
  const runId = openclaw.runId ?? message.runId ?? message.gatewayRunId;
  return typeof runId === "string" && runId.trim() ? runId.trim() : null;
}

function isStrippedReplayCandidate(message: ProjectedMessage) {
  if (message.role !== "user" && message.role !== "assistant") return false;
  if (runIdentityOf(message.data)) return false;
  return Boolean(textOf(message.data));
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

  getSegmentForTranscript(params: { sessionKey: string; sessionId?: string | null; sessionFile?: string | null; active?: boolean | null }) {
    if (params.active === false && params.sessionFile) {
      const row = this.db.prepare(`
        SELECT segment_id, session_key, session_id, segment_index, base_seq
        FROM v2_chat_segments
        WHERE session_key = @sessionKey AND is_active = 0 AND session_file = @sessionFile
        ORDER BY segment_index DESC
        LIMIT 1
      `).get({ sessionKey: params.sessionKey, sessionFile: params.sessionFile }) as { segment_id: string; session_key: string; session_id: string | null; segment_index: number; base_seq: number } | undefined;
      if (!row) return null;
      return { segmentId: row.segment_id, sessionKey: row.session_key, sessionId: row.session_id, segmentIndex: row.segment_index, baseSeq: row.base_seq };
    }
    const row = this.db.prepare(`
      SELECT segment_id, session_key, session_id, segment_index, base_seq
      FROM v2_chat_segments
      WHERE session_key = @sessionKey
        AND (@active IS NULL OR is_active = @active)
        AND (
          (@sessionFile IS NOT NULL AND session_file = @sessionFile)
          OR (@sessionId IS NOT NULL AND session_id = @sessionId)
        )
      ORDER BY
        CASE WHEN @sessionFile IS NOT NULL AND session_file = @sessionFile THEN 0 ELSE 1 END,
        segment_index DESC
      LIMIT 1
    `).get({
      sessionKey: params.sessionKey,
      sessionId: params.sessionId ?? null,
      sessionFile: params.sessionFile ?? null,
      active: params.active === null || params.active === undefined ? null : params.active ? 1 : 0,
    }) as { segment_id: string; session_key: string; session_id: string | null; segment_index: number; base_seq: number } | undefined;
    if (!row) return null;
    return { segmentId: row.segment_id, sessionKey: row.session_key, sessionId: row.session_id, segmentIndex: row.segment_index, baseSeq: row.base_seq };
  }

  ensureArchivedSegment(params: { sessionKey: string; sessionId?: string | null; sessionFile?: string | null; resetReason?: string | null; startedAtMs?: number | null }) {
    const existing = this.getSegmentForTranscript({ ...params, active: false });
    if (existing) return existing;

    const now = Date.now();
    const maxSeqRow = this.db.prepare(`SELECT max(openclaw_seq) AS maxSeq FROM v2_messages WHERE session_key = @sessionKey`).get({ sessionKey: params.sessionKey }) as { maxSeq?: number | null } | undefined;
    const maxSegmentRow = this.db.prepare(`SELECT max(segment_index) AS maxIndex FROM v2_chat_segments WHERE session_key = @sessionKey`).get({ sessionKey: params.sessionKey }) as { maxIndex?: number | null } | undefined;
    const nextIndex = Math.max(-1, Number(maxSegmentRow?.maxIndex ?? -1)) + 1;
    const baseSeq = Math.max(0, Number(maxSeqRow?.maxSeq ?? 0));
    const sessionId = params.sessionId ?? null;
    const segmentId = `${params.sessionKey}::segment::${sessionId ?? "archived"}::${nextIndex}`;
    this.db.prepare(`
      INSERT INTO v2_chat_segments(segment_id, session_key, session_id, session_file, segment_index, base_seq, started_at_ms, ended_at_ms, reset_reason, is_active, created_at_ms, updated_at_ms)
      VALUES (@segmentId, @sessionKey, @sessionId, @sessionFile, @segmentIndex, @baseSeq, @startedAtMs, @now, @resetReason, 0, @now, @now)
    `).run({
      segmentId,
      sessionKey: params.sessionKey,
      sessionId,
      sessionFile: params.sessionFile ?? null,
      segmentIndex: nextIndex,
      baseSeq,
      startedAtMs: params.startedAtMs ?? now,
      resetReason: params.resetReason ?? "archived_transcript",
      now,
    });
    return { segmentId, sessionKey: params.sessionKey, sessionId, segmentIndex: nextIndex, baseSeq };
  }

  archiveImportForFile(params: { sessionKey: string; filePath: string }) {
    const row = this.db.prepare(`
      SELECT session_key, file_path, file_mtime_ms, file_size, segment_id, message_count, imported_at_ms
      FROM v2_archive_imports
      WHERE session_key = @sessionKey AND file_path = @filePath
    `).get(params) as {
      session_key: string;
      file_path: string;
      file_mtime_ms: number;
      file_size: number;
      segment_id: string;
      message_count: number;
      imported_at_ms: number;
    } | undefined;
    if (!row) return null;
    return {
      sessionKey: row.session_key,
      filePath: row.file_path,
      fileMtimeMs: row.file_mtime_ms,
      fileSize: row.file_size,
      segmentId: row.segment_id,
      messageCount: row.message_count,
      importedAtMs: row.imported_at_ms,
    };
  }

  isArchiveImportFresh(params: { sessionKey: string; filePath: string; fileMtimeMs: number; fileSize: number }) {
    const row = this.archiveImportForFile(params);
    if (!row) return false;
    return row.fileMtimeMs === params.fileMtimeMs && row.fileSize === params.fileSize;
  }

  recordArchiveImport(params: { sessionKey: string; filePath: string; fileMtimeMs: number; fileSize: number; segmentId: string; messageCount: number }) {
    this.db.prepare(`
      INSERT INTO v2_archive_imports(session_key, file_path, file_mtime_ms, file_size, segment_id, message_count, imported_at_ms)
      VALUES (@sessionKey, @filePath, @fileMtimeMs, @fileSize, @segmentId, @messageCount, @now)
      ON CONFLICT(session_key, file_path) DO UPDATE SET
        file_mtime_ms = excluded.file_mtime_ms,
        file_size = excluded.file_size,
        segment_id = excluded.segment_id,
        message_count = excluded.message_count,
        imported_at_ms = excluded.imported_at_ms
    `).run({ ...params, now: Date.now() });
  }

  messageCountForSegment(segmentId: string) {
    const row = this.db.prepare(`SELECT count(*) AS count FROM v2_messages WHERE segment_id = @segmentId`).get({ segmentId }) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
  }

  deleteMessagesForSegment(segmentId: string) {
    const result = this.db.prepare(`DELETE FROM v2_messages WHERE segment_id = @segmentId`).run({ segmentId });
    return Number(result.changes ?? 0);
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
    const maxSegmentIndex = maxSegmentRow?.maxIndex;
    const hasAnySegment = maxSegmentIndex !== null && maxSegmentIndex !== undefined;
    const nextIndex = Math.max(-1, Number(maxSegmentIndex ?? -1)) + 1;
    const baseSeq = existing || hasAnySegment ? Math.max(0, Number(maxSeqRow?.maxSeq ?? 0)) : 0;
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
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
        AND json_extract(data_json, '$.__openclaw.gatewayId') = @messageId
      LIMIT 1
    `);
    const existingByGatewaySeq = this.db.prepare(`
      SELECT openclaw_seq
      FROM v2_messages
      WHERE session_key = @sessionKey
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
        AND gateway_seq = @gatewaySeq
      LIMIT 1
    `);
    const existingByRole = this.db.prepare(`
      SELECT openclaw_seq, message_id, role, data_json
      FROM v2_messages
      WHERE session_key = @sessionKey
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
        AND role = @role
      ORDER BY openclaw_seq ASC
      LIMIT 1000
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
    // For the "late user echo" collision: a user message arrives at a seq that
    // is already occupied by an assistant/tool row (because the gateway delivered
    // the live assistant deltas before the user echo for the same turn). We must
    // shift the assistant/tool block by +1 to make room at the user's seq.
    // SQLite enforces the (session_key, segment_id, openclaw_seq) PRIMARY KEY
    // row-by-row, so a naive `seq = seq + 1` ascending update would collide at
    // the next row. Use a two-pass negative-sentinel: first flip to negative,
    // then negate-and-add-one to get the final shifted value. Both passes only
    // touch rows in [openclawSeq, ceiling).
    const nextHardBoundarySeq = this.db.prepare(`
      SELECT min(openclaw_seq) AS seq
      FROM v2_messages
      WHERE session_key = @sessionKey
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
        AND openclaw_seq > @openclawSeq
        AND (role = 'user' OR role = 'system')
    `);
    const shiftAssistantBlockToNegative = this.db.prepare(`
      UPDATE v2_messages
      SET openclaw_seq = -openclaw_seq
      WHERE session_key = @sessionKey
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
        AND openclaw_seq >= @openclawSeq
        AND openclaw_seq < @ceiling
    `);
    const shiftAssistantBlockFromNegative = this.db.prepare(`
      UPDATE v2_messages
      SET openclaw_seq = (-openclaw_seq) + 1
      WHERE session_key = @sessionKey
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
        AND openclaw_seq < 0
    `);
    const readShiftedRows = this.db.prepare(`
      SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM v2_messages
      WHERE session_key = @sessionKey
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
        AND openclaw_seq > @openclawSeq
        AND openclaw_seq <= @ceiling
      ORDER BY openclaw_seq ASC
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
            ?? (existingByGatewayId.get({ sessionKey: message.sessionKey, messageId: message.messageId, segmentId }) as { openclaw_seq: number } | undefined)
          : undefined;
        const gatewaySeqMatch = !idMatch && gatewaySeq > 0
          ? existingByGatewaySeq.get({ sessionKey: message.sessionKey, segmentId, gatewaySeq }) as { openclaw_seq: number } | undefined
          : undefined;
        let strippedReplayMatchedSeq: number | null = null;
        if (idMatch?.openclaw_seq) openclawSeq = idMatch.openclaw_seq;
        else if (isStrippedReplayCandidate(message)) {
          const incomingText = textOf(message.data);
          const replayMatch = (existingByRole.all({ sessionKey: message.sessionKey, segmentId, role: message.role }) as Array<{ openclaw_seq: number; message_id: string | null; role: string | null; data_json: string }>).find((row) => {
            const existingData = fromJson(row.data_json);
            if (textOf(existingData) !== incomingText) return false;
            const existingRunId = runIdentityOf(existingData);
            // Gateway history can replay old rows later with a new message id,
            // new gateway_seq, and no run/idempotency metadata. When the text
            // exactly matches an already projected row, keep the earlier row as
            // canonical. This protects local optimistic user turns and live-run
            // assistant finals from being duplicated by stripped history.
            return Boolean(existingRunId) || row.message_id !== message.messageId;
          });
          if (replayMatch) {
            openclawSeq = replayMatch.openclaw_seq;
            strippedReplayMatchedSeq = replayMatch.openclaw_seq;
          }
        }
        else if (gatewaySeqMatch?.openclaw_seq) openclawSeq = gatewaySeqMatch.openclaw_seq;
        if (strippedReplayMatchedSeq !== null) {
          lastSeq = Math.max(lastSeq, strippedReplayMatchedSeq);
          continue;
        }

        let existing = existingAtSeq.get({
          sessionKey: message.sessionKey,
          openclawSeq,
        }) as { message_id: string | null; role: string | null; data_json: string } | undefined;
        if (gatewaySeqMatch && existing && message.role === "user" && existing.role === "user" && textOf(fromJson(existing.data_json)) === textOf(message.data)) {
          lastSeq = Math.max(lastSeq, openclawSeq);
          continue;
        }
        // A true seq collision is when a DIFFERENT message lands on a seq that is
        // already owned by another message. Detect that by identity (different
        // messageId) AND that it is not just the same logical message being
        // replayed: Gateway re-sends prior user turns with a stripped messageId
        // (no runId/idempotencyKey) on every send. Those replays have the SAME
        // role and SAME text as the row already stored at that seq, so they must
        // overwrite in place, NOT append, or each send duplicates the previous
        // user turn one row down. Only treat it as a collision when the role
        // differs (e.g. an assistant/tool row projecting onto a user's seq) or
        // the text differs (a genuinely different message).
        let existingIsCollision = false;
        if (existing && !idMatch && existing.message_id && message.messageId && existing.message_id !== message.messageId) {
          if (existing.role !== message.role) {
            existingIsCollision = true;
          } else {
            const existingData = fromJson(existing.data_json);
            existingIsCollision = textOf(existingData) !== textOf(message.data);
          }
        }
        if (!idMatch && existing && (existingIsCollision || isOptimisticConflict(existing, message))) {
          const existingRoleIsAssistantOrTool = existing.role === "assistant"
            || existing.role === "tool"
            || existing.role === "toolResult"
            || existing.role === "tool_result"
            || existing.role === "function";
          // Restrict the shift path to the real bug signature: a late gateway
          // user echo arrives at a seq held by an assistant/tool row that
          // belongs to a LIVE run (has a runId in __openclaw, or is the
          // `live:<runId>:assistant` placeholder). Generic non-run-tagged
          // assistant rows (e.g. synthetic history fixtures, replayed history
          // without run metadata) keep the old append-to-end behavior so we
          // don't reorder unrelated historical turns.
          const existingData = existing ? fromJson(existing.data_json) : null;
          const existingHasLiveRunIdentity = Boolean(existing) && (
            runIdentityOf(existingData) !== null
            || (typeof existing!.message_id === "string" && existing!.message_id.startsWith("live:"))
          );
          if (message.role === "user" && existingIsCollision && existingRoleIsAssistantOrTool && existingHasLiveRunIdentity) {
            // Late gateway user echo for a turn whose live assistant/tool rows
            // already landed at this seq. Keep the user at openclawSeq and
            // shift the colliding assistant+tool block by +1 so the user comes
            // first. Ceiling is the next user/system row in the same segment
            // (or maxSeq + 1), so we only move the rows that belong to this
            // turn's run.
            const boundary = nextHardBoundarySeq.get({
              sessionKey: message.sessionKey,
              segmentId,
              openclawSeq,
            }) as { seq?: number | null } | undefined;
            const maxRow = maxSeq.get({ sessionKey: message.sessionKey }) as { maxSeq?: number | null } | undefined;
            const ceiling = boundary?.seq != null ? Number(boundary.seq) : Number(maxRow?.maxSeq ?? openclawSeq) + 1;
            // Safety check: if the assistant/tool block is tightly packed up
            // against the next user/system row (i.e. the row at ceiling - 1 is
            // part of our shift range AND a row exists at ceiling), shifting
            // would collide with the boundary row. Fall back to the old
            // append-to-end behavior in that degenerate case.
            const blockTightAgainstBoundary = boundary?.seq != null && (
              existingAtSeq.get({
                sessionKey: message.sessionKey,
                openclawSeq: ceiling - 1,
              }) as { message_id: string | null } | undefined
            ) != null;
            if (blockTightAgainstBoundary) {
              const fallbackRow = maxSeq.get({ sessionKey: message.sessionKey }) as { maxSeq?: number | null } | undefined;
              const nextSeq = Math.max(openclawSeq, Number(fallbackRow?.maxSeq ?? 0)) + 1;
              openclawSeq = nextSeq;
              existing = existingAtSeq.get({ sessionKey: message.sessionKey, openclawSeq }) as typeof existing;
            } else {
            shiftAssistantBlockToNegative.run({
              sessionKey: message.sessionKey,
              segmentId,
              openclawSeq,
              ceiling,
            });
            shiftAssistantBlockFromNegative.run({
              sessionKey: message.sessionKey,
              segmentId,
            });
            const shiftedRows = readShiftedRows.all({
              sessionKey: message.sessionKey,
              segmentId,
              openclawSeq,
              ceiling,
            }) as Array<{
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
            for (const row of shiftedRows) {
              changedMessages.push({
                sessionKey: row.session_key,
                segmentId: row.segment_id,
                sessionId: row.session_id,
                gatewaySeq: row.gateway_seq ?? undefined,
                openclawSeq: row.openclaw_seq,
                messageId: row.message_id,
                role: row.role,
                data: fromJson(row.data_json) as ProjectedMessage["data"],
                updatedAtMs: row.updated_at_ms,
              });
              lastSeq = Math.max(lastSeq, row.openclaw_seq);
            }
            // The slot at openclawSeq is now empty; clear `existing` so the
            // insert path below treats it as a fresh row.
            existing = undefined;
            }
          } else {
            const row = maxSeq.get({ sessionKey: message.sessionKey }) as { maxSeq?: number | null } | undefined;
            const nextSeq = Math.max(openclawSeq, Number(row?.maxSeq ?? 0)) + 1;
            // openclaw_seq is ordering, not identity. If late Gateway/history rows
            // project onto a seq already owned by a DIFFERENT message, append the
            // incoming row instead of overwriting it. This keeps confirmed
            // optimistic user turns anchored and prevents tool/assistant rows from
            // deleting the user that triggered them.
            openclawSeq = nextSeq;
            existing = existingAtSeq.get({ sessionKey: message.sessionKey, openclawSeq }) as typeof existing;
          }
        }

        let dataForStore = message.data;
        if (existing && message.role === "user") {
          const existingData = fromJson(existing.data_json) as OpenClawMessage;
          const incomingData = message.data as OpenClawMessage;
          const shouldPreserveLocalDisplay = (existingData.__openclaw as Record<string, unknown> | undefined)?.preserveDisplayText === true;
          if (shouldPreserveLocalDisplay) {
            dataForStore = {
              ...incomingData,
              ...(typeof existingData.text === "string" ? { text: existingData.text } : {}),
              ...(existingData.content !== undefined ? { content: existingData.content } : {}),
              ...(incomingData.attachments === undefined && existingData.attachments !== undefined ? { attachments: existingData.attachments } : {}),
              __openclaw: {
                ...(incomingData.__openclaw ?? {}),
                preserveDisplayText: true,
              },
            };
          }
        }
        const dataJson = toJson(dataForStore);
        const changed = !existing || existing.message_id !== message.messageId || existing.role !== message.role || existing.data_json !== dataJson;
        const messageToStore = dataForStore === message.data ? message : { ...message, data: dataForStore };
        const storedMessage = openclawSeq === message.openclawSeq && !segmentId ? messageToStore : { ...messageToStore, segmentId, sessionId, gatewaySeq, openclawSeq };
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

  pruneSegmentToCanonicalMessages(params: { sessionKey: string; segmentId: string | null; baseSeq: number; canonicalMessages: ProjectedMessage[] }) {
    const canonicalSeqs = new Set<number>();
    const canonicalIds = new Set<string>();
    const canonicalGatewaySeqs = new Set<number>();
    const canonicalStrippedReplayTexts = new Set<string>();
    for (const message of params.canonicalMessages) {
      const gatewaySeq = message.gatewaySeq ?? message.openclawSeq;
      canonicalSeqs.add(params.baseSeq + gatewaySeq);
      canonicalGatewaySeqs.add(gatewaySeq);
      if (message.messageId) canonicalIds.add(message.messageId);
      if (isStrippedReplayCandidate(message)) {
        canonicalStrippedReplayTexts.add(`${message.role}\u0000${textOf(message.data)}`);
      }
    }

    const rows = this.db.prepare(`
      SELECT openclaw_seq, message_id, role, data_json
      FROM v2_messages
      WHERE session_key = @sessionKey AND segment_id IS @segmentId
    `).all({ sessionKey: params.sessionKey, segmentId: params.segmentId }) as Array<{ openclaw_seq: number; message_id: string | null; role: string | null; data_json: string }>;
    const deleteRow = this.db.prepare(`
      DELETE FROM v2_messages
      WHERE session_key = @sessionKey AND segment_id IS @segmentId AND openclaw_seq = @openclawSeq
    `);
    const tx = this.db.transaction(() => {
      let pruned = 0;
      for (const row of rows) {
        const data = fromJson(row.data_json) as OpenClawMessage;
        if (isOptimisticData(data)) continue;
        if ((data.__openclaw as Record<string, unknown> | undefined)?.preserveDisplayText === true) continue;
        const gatewayId = data.__openclaw?.gatewayId;
        const gatewaySeq = data.__openclaw?.gatewaySeq;
        const strippedReplayRepresented =
          Boolean(runIdentityOf(data)) &&
          row.role !== null &&
          canonicalStrippedReplayTexts.has(`${row.role}\u0000${textOf(data)}`);
        const represented =
          canonicalSeqs.has(row.openclaw_seq) ||
          (row.message_id !== null && canonicalIds.has(row.message_id)) ||
          (typeof gatewayId === "string" && canonicalIds.has(gatewayId)) ||
          (typeof gatewaySeq === "number" && canonicalGatewaySeqs.has(gatewaySeq)) ||
          strippedReplayRepresented;
        if (represented) continue;
        deleteRow.run({ sessionKey: params.sessionKey, segmentId: params.segmentId, openclawSeq: row.openclaw_seq });
        pruned += 1;
      }
      return pruned;
    });
    return tx() as number;
  }

  resequenceSessionMessages(sessionKey: string) {
    const segments = this.db.prepare(`
      SELECT segment_id, segment_index, is_active, started_at_ms
      FROM v2_chat_segments
      WHERE session_key = @sessionKey
      ORDER BY is_active ASC, started_at_ms ASC, segment_index ASC
    `).all({ sessionKey }) as Array<{ segment_id: string; segment_index: number; is_active: number; started_at_ms: number }>;
    if (segments.length === 0) return { changedMessages: 0, changedSegments: 0 };

    const messagesForSegment = this.db.prepare(`
      SELECT rowid AS rowid, openclaw_seq, gateway_seq
      FROM v2_messages
      WHERE session_key = @sessionKey AND segment_id = @segmentId
      ORDER BY COALESCE(gateway_seq, openclaw_seq) ASC, openclaw_seq ASC
    `);
    const updateMessageTemp = this.db.prepare(`
      UPDATE v2_messages
      SET openclaw_seq = @tempSeq
      WHERE rowid = @rowid
    `);
    const updateMessageFinal = this.db.prepare(`
      UPDATE v2_messages
      SET openclaw_seq = @openclawSeq
      WHERE rowid = @rowid
    `);
    const updateSegmentTemp = this.db.prepare(`
      UPDATE v2_chat_segments
      SET segment_index = @tempIndex, base_seq = @baseSeq, updated_at_ms = @now
      WHERE segment_id = @segmentId
    `);
    const updateSegmentFinal = this.db.prepare(`
      UPDATE v2_chat_segments
      SET segment_index = @segmentIndex, updated_at_ms = @now
      WHERE segment_id = @segmentId
    `);

    const tx = this.db.transaction(() => {
      const now = Date.now();
      const plannedMessages: Array<{ rowid: number; oldSeq: number; newSeq: number }> = [];
      let nextSeq = 1;
      let changedSegments = 0;
      segments.forEach((segment, index) => {
        const baseSeq = nextSeq - 1;
        if (segment.segment_index !== index) changedSegments += 1;
        updateSegmentTemp.run({ segmentId: segment.segment_id, tempIndex: -(index + 1), baseSeq, now });
        const rows = messagesForSegment.all({ sessionKey, segmentId: segment.segment_id }) as Array<{ rowid: number; openclaw_seq: number; gateway_seq: number | null }>;
        for (const row of rows) {
          plannedMessages.push({ rowid: row.rowid, oldSeq: row.openclaw_seq, newSeq: nextSeq });
          nextSeq += 1;
        }
      });
      plannedMessages.forEach((row, index) => updateMessageTemp.run({ rowid: row.rowid, tempSeq: -(index + 1) }));
      let changedMessages = 0;
      plannedMessages.forEach((row) => {
        if (row.oldSeq !== row.newSeq) changedMessages += 1;
        updateMessageFinal.run({ rowid: row.rowid, openclawSeq: row.newSeq });
      });
      segments.forEach((segment, index) => updateSegmentFinal.run({ segmentId: segment.segment_id, segmentIndex: index, now }));
      return { changedMessages, changedSegments };
    });
    return tx() as { changedMessages: number; changedSegments: number };
  }

  searchMessages(sessionKey: string, query: string, limit = 50): Array<{ openclawSeq: number; messageId: string | null; role: string | null; snippet: string }> {
    if (!query.trim()) return [];
    const pattern = `%${query.replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    const rows = this.db.prepare(`
      SELECT openclaw_seq, message_id, role, data_json
      FROM v2_messages
      WHERE session_key = @sessionKey
        AND data_json LIKE @pattern
      ORDER BY openclaw_seq DESC
      LIMIT @limit
    `).all({ sessionKey, pattern, limit }) as Array<{
      openclaw_seq: number;
      message_id: string | null;
      role: string | null;
      data_json: string;
    }>;
    return rows.map((row) => {
      try {
        const data = JSON.parse(row.data_json) as Record<string, unknown>;
        const text = typeof data.text === 'string' ? data.text : '';
        const lower = text.toLowerCase();
        const idx = lower.indexOf(query.toLowerCase());
        const start = Math.max(0, idx - 40);
        const end = Math.min(text.length, idx + query.length + 40);
        const snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
        return { openclawSeq: row.openclaw_seq, messageId: row.message_id, role: row.role, snippet };
      } catch {
        return { openclawSeq: row.openclaw_seq, messageId: row.message_id, role: row.role, snippet: '' };
      }
    });
  }

  countMessages(sessionKey: string): number {
    const row = this.db.prepare(`SELECT count(*) AS count FROM v2_messages WHERE session_key = @sessionKey`).get({ sessionKey }) as { count?: number } | undefined;
    return Number(row?.count ?? 0);
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
      SELECT openclaw_seq, segment_id, session_id, data_json
      FROM v2_messages
      WHERE session_key = @sessionKey AND message_id = @optimisticId
      LIMIT 1
    `).get({ sessionKey, optimisticId }) as { openclaw_seq: number; segment_id: string | null; session_id: string | null; data_json: string } | undefined;
    if (!existing) return null;

    const activeSegment = this.getActiveSegment(sessionKey);
    const segmentId = existing.segment_id ?? gatewayMessage.segmentId ?? activeSegment?.segmentId ?? null;
    const sessionId = existing.session_id ?? gatewayMessage.sessionId ?? activeSegment?.sessionId ?? null;
    const gatewaySeq = gatewayMessage.gatewaySeq ?? gatewayMessage.openclawSeq;
    const projectedGatewaySeq = segmentId && activeSegment?.segmentId === segmentId ? activeSegment.baseSeq + gatewaySeq : null;
    // Keep the optimistic row's locally allocated openclaw_seq as the canonical
    // transcript order. Do not move it to baseSeq + gatewaySeq on confirm: that
    // projection can overshoot when the active segment's baseSeq was frozen
    // before local optimistic appends, causing the confirmed user message to
    // collide with assistant/tool rows from the same run. Gateway sequence is
    // retained separately in gateway_seq / __openclaw.gatewaySeq for matching.
    const confirmedOpenclawSeq = existing.openclaw_seq;

    const deleteGatewayDuplicate = this.db.prepare(`
      DELETE FROM v2_messages
      WHERE session_key = @sessionKey
        AND message_id = @gatewayMessageId
        AND (@segmentId IS NULL OR segment_id IS @segmentId)
    `);
    const deleteProjectedDuplicate = this.db.prepare(`
      DELETE FROM v2_messages
      WHERE session_key = @sessionKey
        AND segment_id IS @segmentId
        AND openclaw_seq = @projectedGatewaySeq
        AND message_id IS NOT @optimisticId
    `);
    const updateOptimistic = this.db.prepare(`
      UPDATE v2_messages
      SET openclaw_seq = @confirmedOpenclawSeq,
          segment_id = COALESCE(@segmentId, segment_id),
          session_id = COALESCE(@sessionId, session_id),
          gateway_seq = COALESCE(@gatewaySeq, gateway_seq),
          role = @role,
          data_json = @dataJson,
          updated_at_ms = @updatedAtMs
      WHERE session_key = @sessionKey AND message_id = @optimisticId
    `);

    const existingData = fromJson(existing.data_json) as OpenClawMessage;
    const gatewayHasDisplayText = textOf(gatewayMessage.data).length > 0;
    const existingHasDisplayText = textOf(existingData).length > 0;
    const preserveOptimisticDisplay = !gatewayHasDisplayText && existingHasDisplayText;
    const existingOpenClaw = existingData.__openclaw ?? {};
    const gatewayOpenClaw = gatewayMessage.data.__openclaw ?? {};
    const preserveLocalDisplayText = (existingOpenClaw as Record<string, unknown>).preserveDisplayText === true;
    const preservedRunId = gatewayOpenClaw.runId ?? existingOpenClaw.runId;
    const data = {
      ...gatewayMessage.data,
      ...((preserveOptimisticDisplay || preserveLocalDisplayText) && typeof existingData.text === "string" ? { text: existingData.text } : {}),
      ...((preserveOptimisticDisplay || preserveLocalDisplayText) && existingData.content !== undefined ? { content: existingData.content } : {}),
      ...((gatewayMessage.data as OpenClawMessage).attachments === undefined && existingData.attachments !== undefined ? { attachments: existingData.attachments } : {}),
      isOptimistic: false,
      __clientOptimistic: false,
      __openclaw: {
        ...gatewayOpenClaw,
        ...(typeof preservedRunId === "string" && preservedRunId.trim() ? { runId: preservedRunId.trim() } : {}),
        ...(preserveLocalDisplayText ? { preserveDisplayText: true } : {}),
        id: optimisticId,
        gatewayId: gatewayMessage.messageId,
        gatewaySeq,
        segmentId,
      },
    } as OpenClawMessage;
    const confirmed: ProjectedMessage = {
      ...gatewayMessage,
      segmentId,
      sessionId,
      gatewaySeq,
      openclawSeq: confirmedOpenclawSeq,
      messageId: optimisticId,
      data,
      updatedAtMs: gatewayMessage.updatedAtMs,
    };
    const tx = this.db.transaction(() => {
      if (gatewayMessage.messageId && gatewayMessage.messageId !== optimisticId) {
        deleteGatewayDuplicate.run({ sessionKey, gatewayMessageId: gatewayMessage.messageId, segmentId });
      }
      if (projectedGatewaySeq !== null && projectedGatewaySeq === confirmedOpenclawSeq) {
        deleteProjectedDuplicate.run({ sessionKey, segmentId, projectedGatewaySeq, optimisticId });
      }
      updateOptimistic.run({
        sessionKey,
        optimisticId,
        segmentId,
        sessionId,
        gatewaySeq,
        confirmedOpenclawSeq,
        role: confirmed.role,
        dataJson: toJson(confirmed.data),
        updatedAtMs: confirmed.updatedAtMs,
      });
    });
    tx();
    return confirmed;
  }

  deleteMessageById(sessionKey: string, messageId: string) {
    return this.db.prepare(`
      DELETE FROM v2_messages
      WHERE session_key = @sessionKey AND message_id = @messageId
    `).run({ sessionKey, messageId }).changes;
  }

  /**
   * Atomically delete ALL local projection state for the given session keys.
   * Every per-session, cross-table delete runs inside a SINGLE better-sqlite3
   * transaction: if any table delete throws, the whole batch rolls back so we
   * never leave a session half-deleted across the v2_* tables. The previous
   * inline implementation ran each delete in a silent `try/catch {}`, which
   * both swallowed errors and left orphaned rows on partial failure.
   * Returns the number of rows removed per table.
   */
  deleteSessionProjections(sessionKeys: string[]): { sessions: number; rowsByTable: Record<string, number> } {
    const tables = [
      "v2_messages",
      "v2_runs",
      "v2_tool_calls",
      "v2_sessions",
      "v2_gateway_offsets",
      "v2_projection_events",
      "v2_chat_segments",
      "v2_archive_imports",
    ] as const;
    const statements = tables.map((table) => ({
      table,
      stmt: this.db.prepare(`DELETE FROM ${table} WHERE session_key = @sessionKey`),
    }));
    const rowsByTable: Record<string, number> = Object.fromEntries(tables.map((table) => [table, 0]));
    const tx = this.db.transaction((keys: string[]) => {
      for (const sessionKey of keys) {
        for (const { table, stmt } of statements) {
          rowsByTable[table] += stmt.run({ sessionKey }).changes;
        }
      }
    });
    tx(sessionKeys);
    return { sessions: sessionKeys.length, rowsByTable };
  }

  findLatestLiveAssistantByText(sessionKey: string, text: string): ProjectedMessage | null {
    const row = this.db.prepare(`
      SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM v2_messages
      WHERE session_key = @sessionKey
        AND role = 'assistant'
        AND message_id LIKE 'live:%:assistant'
        AND json_extract(data_json, '$.text') = @text
      ORDER BY openclaw_seq DESC
      LIMIT 1
    `).get({ sessionKey, text }) as {
      session_key: string;
      segment_id: string | null;
      session_id: string | null;
      gateway_seq: number | null;
      openclaw_seq: number;
      message_id: string | null;
      role: string | null;
      data_json: string;
      updated_at_ms: number;
    } | undefined;
    if (!row) return null;
    return {
      sessionKey: row.session_key,
      segmentId: row.segment_id,
      sessionId: row.session_id,
      gatewaySeq: row.gateway_seq ?? undefined,
      openclawSeq: row.openclaw_seq,
      messageId: row.message_id,
      role: row.role,
      data: fromJson(row.data_json) as OpenClawMessage,
      updatedAtMs: row.updated_at_ms,
    };
  }

  findMessageById(sessionKey: string, messageId: string): ProjectedMessage | null {
    const row = this.db.prepare(`
      SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM v2_messages
      WHERE session_key = @sessionKey AND message_id = @messageId
      LIMIT 1
    `).get({ sessionKey, messageId }) as {
      session_key: string;
      segment_id: string | null;
      session_id: string | null;
      gateway_seq: number | null;
      openclaw_seq: number;
      message_id: string | null;
      role: string | null;
      data_json: string;
      updated_at_ms: number;
    } | undefined;
    if (!row) return null;
    return {
      sessionKey: row.session_key,
      segmentId: row.segment_id,
      sessionId: row.session_id,
      gatewaySeq: row.gateway_seq ?? undefined,
      openclawSeq: row.openclaw_seq,
      messageId: row.message_id,
      role: row.role,
      data: fromJson(row.data_json) as OpenClawMessage,
      updatedAtMs: row.updated_at_ms,
    };
  }

  latestProjectionEvent(sessionKey: string): ProjectionEvent | null {
    const row = this.db.prepare(`
      SELECT cursor, session_key, event_type, payload_json, created_at_ms
      FROM v2_projection_events
      WHERE session_key = @sessionKey
      ORDER BY cursor DESC
      LIMIT 1
    `).get({ sessionKey }) as { cursor: number; session_key: string | null; event_type: string; payload_json: string; created_at_ms: number } | undefined;
    if (!row) return null;
    return {
      cursor: row.cursor,
      sessionKey: row.session_key,
      eventType: row.event_type,
      payload: fromJson(row.payload_json),
      createdAtMs: row.created_at_ms,
    };
  }

  latestSessionCursor(sessionKey: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(max(cursor), 0) AS cursor
      FROM v2_projection_events
      WHERE session_key = @sessionKey
        AND event_type != 'chat.bootstrap'
    `).get({ sessionKey }) as { cursor: number | null } | undefined;
    return row?.cursor ?? 0;
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
    const limit = Math.max(1, Math.min(10_000, opts.limit ?? 200));
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

  listAllMessages(sessionKey: string): ProjectedMessage[] {
    const rows = this.db.prepare(`
      SELECT session_key, segment_id, session_id, gateway_seq, openclaw_seq, message_id, role, data_json, updated_at_ms
      FROM v2_messages
      WHERE session_key = @sessionKey
      ORDER BY openclaw_seq ASC
    `).all({ sessionKey }) as Array<{
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
