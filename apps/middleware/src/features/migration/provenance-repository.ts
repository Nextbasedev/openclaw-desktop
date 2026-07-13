import type Database from "better-sqlite3";

export const IMPORT_PROVENANCE_VERSION = 1;
export type ImportedPlatformKind = "telegram" | "discord";
export type ImportLifecycle = "active" | "local_delete_tombstone";

function isImportedPlatformKind(value: unknown): value is ImportedPlatformKind {
  return value === "telegram" || value === "discord";
}

export type ImportProvenance = {
  desktopSessionKey: string;
  platformKind: ImportedPlatformKind;
  sourceSessionKey: string;
  sourceSessionId: string | null;
  platformSpaceId: string | null;
  lifecycle: ImportLifecycle;
  metadataVersion: number;
  createdAtMs: number;
  updatedAtMs: number;
};

type Row = {
  desktop_session_key: string;
  platform_kind: ImportedPlatformKind;
  source_session_key: string;
  source_session_id: string | null;
  platform_space_id: string | null;
  lifecycle: ImportLifecycle;
  metadata_version: number;
  created_at_ms: number;
  updated_at_ms: number;
};

function toRecord(row: Row): ImportProvenance {
  return {
    desktopSessionKey: row.desktop_session_key,
    platformKind: row.platform_kind,
    sourceSessionKey: row.source_session_key,
    sourceSessionId: row.source_session_id,
    platformSpaceId: row.platform_space_id,
    lifecycle: row.lifecycle,
    metadataVersion: row.metadata_version,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export class ImportProvenanceRepository {
  constructor(private readonly db: Database.Database) {}

  findByDesktopSessionKey(desktopSessionKey: string): ImportProvenance | null {
    const row = this.db.prepare("SELECT * FROM v2_import_provenance WHERE desktop_session_key = ?").get(desktopSessionKey) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  /**
   * Prefers the active provenance row for the given (platformKind, sourceSessionKey);
   * falls back to the newest tombstoned row if no active row exists. Multiple rows
   * can share the same source when legacy desktop session keys were tombstoned
   * before a re-import allocated a new desktop session key.
   */
  findByPlatformSource(platformKind: ImportedPlatformKind, sourceSessionKey: string): ImportProvenance | null {
    const row = this.db.prepare(
      `SELECT * FROM v2_import_provenance
       WHERE platform_kind = ? AND source_session_key = ?
       ORDER BY (lifecycle = 'active') DESC, updated_at_ms DESC
       LIMIT 1`,
    ).get(platformKind, sourceSessionKey) as Row | undefined;
    return row ? toRecord(row) : null;
  }

  findAllByPlatformSource(platformKind: ImportedPlatformKind, sourceSessionKey: string): ImportProvenance[] {
    const rows = this.db.prepare(
      `SELECT * FROM v2_import_provenance
       WHERE platform_kind = ? AND source_session_key = ?
       ORDER BY (lifecycle = 'active') DESC, updated_at_ms DESC`,
    ).all(platformKind, sourceSessionKey) as Row[];
    return rows.map(toRecord);
  }

  /** Returns all active durable imports across every platform. Used by bulk delete flows. */
  enumerateActive(): ImportProvenance[] {
    const rows = this.db.prepare(
      `SELECT * FROM v2_import_provenance WHERE lifecycle = 'active' ORDER BY updated_at_ms DESC`,
    ).all() as Row[];
    return rows.map(toRecord);
  }

  isActive(platformKind: ImportedPlatformKind, sourceSessionKey: string) {
    return this.findByPlatformSource(platformKind, sourceSessionKey)?.lifecycle === "active";
  }

  /**
   * Insert or update a provenance row keyed by desktopSessionKey (PRIMARY KEY).
   *
   * Invariant: at most one row for (platformKind, sourceSessionKey) may be
   * `active`. If an active row already exists for a *different* desktop session
   * key and the caller wants to activate a new one, the existing active row is
   * atomically demoted to `local_delete_tombstone` in the same transaction.
   *
   * This preserves every legacy desktop session key so Gateway session sync can
   * recognise them as tombstones and never resurrect them into compat state.
   */
  upsert(input: Omit<ImportProvenance, "metadataVersion" | "createdAtMs" | "updatedAtMs"> & { metadataVersion?: number; nowMs?: number }) {
    const nowMs = input.nowMs ?? Date.now();
    const runTx = this.db.transaction(() => {
      // Preserve existing createdAtMs when we're updating the same desktop key.
      const existingSameDesktop = this.findByDesktopSessionKey(input.desktopSessionKey);
      // If activating a new desktop key while another active row exists for the
      // same source, demote the previous active row to a tombstone in-place.
      if (input.lifecycle === "active") {
        const active = this.db.prepare(
          `SELECT * FROM v2_import_provenance
           WHERE platform_kind = ? AND source_session_key = ? AND lifecycle = 'active' AND desktop_session_key <> ?`,
        ).get(input.platformKind, input.sourceSessionKey, input.desktopSessionKey) as Row | undefined;
        if (active) {
          this.db.prepare(
            `UPDATE v2_import_provenance
             SET lifecycle = 'local_delete_tombstone', updated_at_ms = ?
             WHERE desktop_session_key = ?`,
          ).run(nowMs, active.desktop_session_key);
        }
      }
      this.db.prepare(`
        INSERT INTO v2_import_provenance(
          desktop_session_key, platform_kind, source_session_key, source_session_id,
          platform_space_id, lifecycle, metadata_version, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(desktop_session_key) DO UPDATE SET
          platform_kind = excluded.platform_kind,
          source_session_key = excluded.source_session_key,
          source_session_id = COALESCE(excluded.source_session_id, v2_import_provenance.source_session_id),
          platform_space_id = COALESCE(excluded.platform_space_id, v2_import_provenance.platform_space_id),
          lifecycle = excluded.lifecycle,
          metadata_version = excluded.metadata_version,
          updated_at_ms = excluded.updated_at_ms
      `).run(
        input.desktopSessionKey,
        input.platformKind,
        input.sourceSessionKey,
        input.sourceSessionId,
        input.platformSpaceId,
        input.lifecycle,
        input.metadataVersion ?? IMPORT_PROVENANCE_VERSION,
        existingSameDesktop?.createdAtMs ?? nowMs,
        nowMs,
      );
    });
    runTx();
    return this.findByDesktopSessionKey(input.desktopSessionKey)!;
  }

  markLocalDeleteTombstone(desktopSessionKey: string, nowMs = Date.now()) {
    const existing = this.findByDesktopSessionKey(desktopSessionKey);
    if (!existing) return null;
    if (existing.lifecycle === "local_delete_tombstone") return existing;
    this.db.prepare(
      `UPDATE v2_import_provenance
       SET lifecycle = 'local_delete_tombstone', updated_at_ms = ?
       WHERE desktop_session_key = ?`,
    ).run(nowMs, desktopSessionKey);
    return this.findByDesktopSessionKey(desktopSessionKey);
  }

  /** Bulk-tombstone every currently-active durable import atomically. */
  tombstoneAllActive(nowMs = Date.now()): ImportProvenance[] {
    const active = this.enumerateActive();
    if (active.length === 0) return [];
    const stmt = this.db.prepare(
      `UPDATE v2_import_provenance
       SET lifecycle = 'local_delete_tombstone', updated_at_ms = ?
       WHERE desktop_session_key = ? AND lifecycle = 'active'`,
    );
    const tx = this.db.transaction((records: ImportProvenance[]) => {
      for (const record of records) stmt.run(nowMs, record.desktopSessionKey);
    });
    tx(active);
    return active.map((record) => ({ ...record, lifecycle: "local_delete_tombstone", updatedAtMs: nowMs }));
  }

  backfillLegacyCompatState() {
    const rows = this.db.prepare("SELECT key, data_json FROM v2_compat_state WHERE key IN ('sessions', 'chats')").all() as Array<{ key: string; data_json: string }>;
    let inserted = 0;
    for (const row of rows) {
      let records: unknown;
      try { records = JSON.parse(row.data_json); } catch { continue; }
      if (!Array.isArray(records)) continue;
      for (const value of records) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const record = value as Record<string, unknown>;
        const importedFrom = record.importedFrom && typeof record.importedFrom === "object" && !Array.isArray(record.importedFrom)
          ? record.importedFrom as Record<string, unknown>
          : null;
        const platformKind = importedFrom?.kind;
        const sourceSessionKey = importedFrom?.sourceSessionKey;
        const desktopSessionKey = typeof record.sessionKey === "string" ? record.sessionKey : typeof record.key === "string" ? record.key : null;
        if (!isImportedPlatformKind(platformKind) || typeof sourceSessionKey !== "string" || !sourceSessionKey || !desktopSessionKey) continue;
        if (this.findByDesktopSessionKey(desktopSessionKey)) continue;
        const lifecycle: ImportLifecycle = record.deleted === true ? "local_delete_tombstone" : "active";
        this.upsert({
          desktopSessionKey,
          platformKind,
          sourceSessionKey,
          sourceSessionId: typeof importedFrom?.sourceSessionId === "string" ? importedFrom.sourceSessionId : null,
          platformSpaceId: typeof record.spaceId === "string" ? record.spaceId : null,
          lifecycle,
        });
        inserted += 1;
      }
    }
    return inserted;
  }
}
