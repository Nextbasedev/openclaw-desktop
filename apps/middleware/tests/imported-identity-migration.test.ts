import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { migrateDatabase, readSchemaVersion } from "../src/db/migrate.js";
import { ImportProvenanceRepository } from "../src/features/migration/provenance-repository.js";
import { gatewayMigrationMetadata, gatewayMigrationProvenance } from "../src/features/migration/runtime.js";
import { clearSyncGatewaySessionsCache, forceReloadCompatStateForTests } from "../src/features/compat/routes.js";

type CompatRow = { sessionKey?: string; key?: string; deleted?: boolean; archived?: boolean; importedFrom?: { kind?: string; sourceSessionKey?: string } };

function config(): MiddlewareConfig {
  return { host: "127.0.0.1", port: 8787, databasePath: path.join(os.tmpdir(), `openclaw-import-identity-${Date.now()}-${Math.random()}.sqlite`), openclawGatewayUrl: "ws://127.0.0.1:1", nodeEnv: "test" };
}

function saveCompat(db: Database.Database, key: string, value: unknown) {
  db.prepare("INSERT INTO v2_compat_state(key, data_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, updated_at_ms = excluded.updated_at_ms")
    .run(key, JSON.stringify(value), Date.now());
}

afterEach(() => vi.restoreAllMocks());

describe("durable imported identity", () => {
  test("reads versioned import metadata from Gateway session records", () => {
    const metadata = gatewayMigrationMetadata({ platformKind: "discord", sourceSessionKey: "agent:main:discord:guild:1:channel:2", sourceSessionId: "discord-id" });
    expect(gatewayMigrationProvenance({ entry: { metadata } })).toEqual({ platformKind: "discord", sourceSessionKey: "agent:main:discord:guild:1:channel:2", sourceSessionId: "discord-id" });
  });

  test("migrates legacy importedFrom state idempotently into durable provenance", () => {
    const db = new Database(config().databasePath);
    migrateDatabase(db);
    saveCompat(db, "sessions", [{ sessionKey: "agent:main:desktop:migrated-telegram-old", spaceId: "space_old", importedFrom: { kind: "telegram", sourceSessionKey: "agent:main:telegram:group:-1:topic:2" } }]);
    const repository = new ImportProvenanceRepository(db);
    expect(readSchemaVersion(db)).toBe(5);
    expect(repository.backfillLegacyCompatState()).toBe(1);
    expect(repository.backfillLegacyCompatState()).toBe(0);
    expect(repository.findByDesktopSessionKey("agent:main:desktop:migrated-telegram-old")).toMatchObject({ platformKind: "telegram", sourceSessionKey: "agent:main:telegram:group:-1:topic:2", platformSpaceId: "space_old", lifecycle: "active" });
    repository.markLocalDeleteTombstone("agent:main:desktop:migrated-telegram-old");
    repository.upsert({ desktopSessionKey: "agent:main:desktop:migrated-telegram-reimport", platformKind: "telegram", sourceSessionKey: "agent:main:telegram:group:-1:topic:2", sourceSessionId: null, platformSpaceId: "space_new", lifecycle: "active" });
    expect(repository.findByPlatformSource("telegram", "agent:main:telegram:group:-1:topic:2")).toMatchObject({ desktopSessionKey: "agent:main:desktop:migrated-telegram-reimport", lifecycle: "active" });
    db.close();
  });

  test("Gateway sync restores a reset imported projection without adopting a user Telegram space", async () => {
    const testConfig = config();
    const desktopSessionKey = "agent:main:desktop:migrated-telegram-old";
    const sourceSessionKey = "agent:main:telegram:group:-1:topic:2";
    const db = new Database(testConfig.databasePath);
    migrateDatabase(db);
    saveCompat(db, "spaces", [{ id: "space_default", name: "My Workspace", archived: false }, { id: "space_user_telegram", name: "Telegram", archived: false }]);
    saveCompat(db, "activeSpaceId", "space_default");
    saveCompat(db, "sessions", [{ sessionKey: desktopSessionKey, spaceId: "space_old", importedFrom: { kind: "telegram", sourceSessionKey } }]);
    db.close();

    const first = await createApp(testConfig);
    await first.close();
    const reset = new Database(testConfig.databasePath);
    reset.prepare("DELETE FROM v2_compat_state WHERE key IN ('spaces', 'activeSpaceId', 'sessions', 'chats', 'projects', 'topics')").run();
    reset.close();

    const app = await createApp(testConfig);
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => method === "sessions.list" ? { sessions: [{ key: desktopSessionKey, label: "Imported topic", agentId: "main" }] } : {});
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const platformSpace = bootstrap.json().spaces.find((space: { importedFrom?: { kind?: string }; id?: string }) => space.importedFrom?.kind === "telegram");
    expect(platformSpace).toBeTruthy();
    expect(platformSpace.id).not.toBe("space_user_telegram");
    const sessions = await app.inject({ method: "GET", url: `/api/sessions?spaceId=${platformSpace.id}` });
    expect(sessions.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: desktopSessionKey, projectId: null, topicId: null, importedFrom: { kind: "telegram", sourceSessionKey } })]));
    await app.close();
  });

  test("direct import leaves a same-named user platform space untouched", async () => {
    const testConfig = config();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-import-space-marker-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const key = "agent:main:telegram:direct:42";
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sourceFile = path.join(sessionsDir, "source.jsonl");
    const targetFile = path.join(sessionsDir, "target.jsonl");
    fs.writeFileSync(sourceFile, `${JSON.stringify({ type: "message", id: "m1", message: { role: "user", content: "marker test" } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [key]: { sessionId: "42", sessionFile: sourceFile, displayName: "Marker test" } }));
    const db = new Database(testConfig.databasePath);
    migrateDatabase(db);
    saveCompat(db, "spaces", [{ id: "space_default", name: "My Workspace", archived: false }, { id: "space_user_telegram", name: "Telegram", archived: false }]);
    saveCompat(db, "activeSpaceId", "space_default");
    db.close();

    const app = await createApp(testConfig);
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => method === "sessions.create" ? { payload: { entry: { sessionFile: targetFile } } } : {});
    const imported = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [key], skipAlreadyImported: false } });
    expect(imported.json().summary).toMatchObject({ imported: 1 });
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({
      metadata: gatewayMigrationMetadata({ platformKind: "telegram", sourceSessionKey: key, sourceSessionId: "42" }),
    }), 30_000);
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const spaces = bootstrap.json().spaces;
    expect(spaces).toEqual(expect.arrayContaining([expect.objectContaining({ id: "space_user_telegram", name: "Telegram" })]));
    expect(spaces).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Telegram", importedFrom: { kind: "telegram", scope: "session-migration" } })]));
    await app.close();
  });

  test("re-import after tombstone: sync of both old and new Gateway desktop keys never resurrects the old import", async () => {
    // Invariant: once a durable imported identity is tombstoned locally, no
    // subsequent Gateway sync can reproject that desktop session key into
    // compat state, even when the same source has been re-imported to a new
    // desktop session key. This test exercises the actual
    // syncGatewaySessionsUncached path via GET /api/chats after a re-import.
    const testConfig = config();
    const oldDesktopKey = "agent:main:desktop:migrated-telegram-old";
    const newDesktopKey = "agent:main:desktop:migrated-telegram-reimport";
    const sourceSessionKey = "agent:main:telegram:group:-1:topic:2";
    const db = new Database(testConfig.databasePath);
    migrateDatabase(db);
    saveCompat(db, "spaces", [{ id: "space_tg", name: "Telegram", archived: false, importedFrom: { kind: "telegram", scope: "session-migration" } }]);
    saveCompat(db, "activeSpaceId", "space_tg");
    saveCompat(db, "sessions", [{ id: "session_old", sessionKey: oldDesktopKey, key: oldDesktopKey, spaceId: "space_tg", importedFrom: { kind: "telegram", sourceSessionKey } }]);
    saveCompat(db, "chats", [{ id: "chat_old", sessionKey: oldDesktopKey, spaceId: "space_tg", importedFrom: { kind: "telegram", sourceSessionKey } }]);
    db.close();

    const app = await createApp(testConfig);
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }; importProvenance: ImportProvenanceRepository } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));

    // Step 1: local-only delete of the imported chat tombstones the old
    // durable row without touching Gateway.
    context.gateway.request = vi.fn(async () => ({ sessions: [] }));
    const deleted = await app.inject({ method: "DELETE", url: `/api/chats/chat_old` });
    expect(deleted.statusCode).toBe(200);
    expect(context.gateway.request.mock.calls.some((call: unknown[]) => call[0] === "sessions.delete")).toBe(false);
    expect(context.importProvenance.findByDesktopSessionKey(oldDesktopKey)?.lifecycle).toBe("local_delete_tombstone");

    // Step 2: user re-imports the same source into a fresh desktop session key.
    // The provenance repository allocates a new active row and any concurrent
    // active row for the same source is atomically demoted by upsert. We also
    // add the new compat projections that /api/migration/telegram/import would
    // have created for the new desktop session key.
    clearSyncGatewaySessionsCache();
    const before = context.importProvenance.findAllByPlatformSource("telegram", sourceSessionKey).map((row) => ({ key: row.desktopSessionKey, lifecycle: row.lifecycle }));
    expect(before).toEqual([{ key: oldDesktopKey, lifecycle: "local_delete_tombstone" }]);
    context.importProvenance.upsert({
      desktopSessionKey: newDesktopKey,
      platformKind: "telegram",
      sourceSessionKey,
      sourceSessionId: null,
      platformSpaceId: "space_tg",
      lifecycle: "active",
    });
    // Simulate the compat projections that a re-import would produce by
    // driving them through POST /api/chats — but simpler: seed via saveCompat
    // and force a reload with a distinct compat load key so loadCompatState
    // picks up the new rows even inside the same test process.
    const dbCompat = new Database(testConfig.databasePath);
    saveCompat(dbCompat, "sessions", [{ id: "session_new", sessionKey: newDesktopKey, key: newDesktopKey, spaceId: "space_tg", importedFrom: { kind: "telegram", sourceSessionKey } }]);
    saveCompat(dbCompat, "chats", [{ id: "chat_new", sessionKey: newDesktopKey, spaceId: "space_tg", importedFrom: { kind: "telegram", sourceSessionKey } }]);
    dbCompat.close();
    // Force a compat state reload the same way an app restart would.
    forceReloadCompatStateForTests(context as unknown as import("../src/app.js").AppContext);

    // Step 3: Gateway continues to list BOTH the old and the new desktop
    // sessions. Import metadata identifies each session as originating from
    // the same source. Sync must not resurrect the old desktop key while the
    // new one remains projected as an active import.
    const gatewayMeta = gatewayMigrationMetadata({ platformKind: "telegram", sourceSessionKey, sourceSessionId: null });
    context.gateway.request = vi.fn(async (method: string) => method === "sessions.list" ? { sessions: [
      { key: oldDesktopKey, label: "Imported topic (legacy)", agentId: "main", metadata: gatewayMeta },
      { key: newDesktopKey, label: "Imported topic", agentId: "main", metadata: gatewayMeta },
    ] } : {});
    const chats = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    const returnedSessionKeys = chats.json().chats.map((c: { sessionKey?: string }) => c.sessionKey);
    expect(returnedSessionKeys).not.toContain(oldDesktopKey);
    expect(returnedSessionKeys).toContain(newDesktopKey);
    expect(context.importProvenance.findByDesktopSessionKey(oldDesktopKey)?.lifecycle).toBe("local_delete_tombstone");
    expect(context.importProvenance.findByDesktopSessionKey(newDesktopKey)?.lifecycle).toBe("active");
    // Invariant: at most one active row per (platformKind, sourceSessionKey).
    expect(context.importProvenance.findAllByPlatformSource("telegram", sourceSessionKey).filter((row) => row.lifecycle === "active")).toHaveLength(1);
    await app.close();
  });

  test("bulk DELETE /api/chats tombstones every active imported identity so Gateway sync cannot resurrect any of them", async () => {
    const testConfig = config();
    const desktopA = "agent:main:desktop:migrated-telegram-a";
    const desktopB = "agent:main:desktop:migrated-discord-b";
    const sourceA = "agent:main:telegram:group:-1:topic:2";
    const sourceB = "agent:main:discord:guild:1:channel:2";
    const db = new Database(testConfig.databasePath);
    migrateDatabase(db);
    saveCompat(db, "spaces", [{ id: "space_tg", name: "Telegram", archived: false, importedFrom: { kind: "telegram", scope: "session-migration" } }, { id: "space_dc", name: "Discord", archived: false, importedFrom: { kind: "discord", scope: "session-migration" } }]);
    saveCompat(db, "activeSpaceId", "space_tg");
    saveCompat(db, "sessions", [
      { id: "session_a", sessionKey: desktopA, key: desktopA, spaceId: "space_tg", importedFrom: { kind: "telegram", sourceSessionKey: sourceA } },
      { id: "session_b", sessionKey: desktopB, key: desktopB, spaceId: "space_dc", importedFrom: { kind: "discord", sourceSessionKey: sourceB } },
    ]);
    saveCompat(db, "chats", [
      { id: "chat_a", sessionKey: desktopA, spaceId: "space_tg", importedFrom: { kind: "telegram", sourceSessionKey: sourceA } },
      { id: "chat_b", sessionKey: desktopB, spaceId: "space_dc", importedFrom: { kind: "discord", sourceSessionKey: sourceB } },
    ]);
    db.close();

    const app = await createApp(testConfig);
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }; importProvenance: ImportProvenanceRepository } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async () => ({ sessions: [] }));

    // Backfill discovers the two imports as active durable rows.
    expect(context.importProvenance.enumerateActive().map((row) => row.desktopSessionKey).sort()).toEqual([desktopB, desktopA].sort());

    const bulkDeleted = await app.inject({ method: "DELETE", url: "/api/chats" });
    expect(bulkDeleted.statusCode).toBe(200);
    expect(bulkDeleted.json()).toMatchObject({ ok: true, tombstonedImports: 2 });
    expect(context.gateway.request.mock.calls.some((call: unknown[]) => call[0] === "sessions.delete")).toBe(false);
    expect(context.importProvenance.findByDesktopSessionKey(desktopA)?.lifecycle).toBe("local_delete_tombstone");
    expect(context.importProvenance.findByDesktopSessionKey(desktopB)?.lifecycle).toBe("local_delete_tombstone");

    // Gateway sync now runs with both imported sessions still alive on Gateway.
    const tgMeta = gatewayMigrationMetadata({ platformKind: "telegram", sourceSessionKey: sourceA, sourceSessionId: null });
    const dcMeta = gatewayMigrationMetadata({ platformKind: "discord", sourceSessionKey: sourceB, sourceSessionId: null });
    context.gateway.request = vi.fn(async (method: string) => method === "sessions.list" ? { sessions: [
      { key: desktopA, label: "Imported topic", agentId: "main", metadata: tgMeta },
      { key: desktopB, label: "Imported channel", agentId: "main", metadata: dcMeta },
    ] } : {});
    const chats = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    const returnedSessionKeys = chats.json().chats.map((c: { sessionKey?: string }) => c.sessionKey);
    expect(returnedSessionKeys).not.toContain(desktopA);
    expect(returnedSessionKeys).not.toContain(desktopB);
    // Tombstones remain intact after the sync attempt.
    expect(context.importProvenance.findByDesktopSessionKey(desktopA)?.lifecycle).toBe("local_delete_tombstone");
    expect(context.importProvenance.findByDesktopSessionKey(desktopB)?.lifecycle).toBe("local_delete_tombstone");
    await app.close();
  });

  test("migrates legacy v4 v2_import_provenance table by dropping the compound UNIQUE constraint", () => {
    // Construct a v4-shaped database with the old UNIQUE(platform_kind, source_session_key)
    // constraint and a pre-existing tombstoned row, then run migrateDatabase.
    const dbPath = config().databasePath;
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE v2_compat_state (key TEXT PRIMARY KEY, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL);
      CREATE TABLE v2_import_provenance (
        desktop_session_key TEXT PRIMARY KEY,
        platform_kind TEXT NOT NULL,
        source_session_key TEXT NOT NULL,
        source_session_id TEXT,
        platform_space_id TEXT,
        lifecycle TEXT NOT NULL DEFAULT 'active' CHECK(lifecycle IN ('active', 'local_delete_tombstone')),
        metadata_version INTEGER NOT NULL DEFAULT 1,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE(platform_kind, source_session_key)
      );
      INSERT INTO v2_meta(key, value) VALUES ('schema_version', '4');
    `);
    legacy.prepare(`INSERT INTO v2_import_provenance(desktop_session_key, platform_kind, source_session_key, source_session_id, platform_space_id, lifecycle, metadata_version, created_at_ms, updated_at_ms) VALUES (?, 'telegram', ?, NULL, NULL, 'local_delete_tombstone', 1, 1, 1)`).run("legacy-old", "src-1");
    // The legacy compound UNIQUE constraint would forbid a second row for the same source. Confirm.
    expect(() => legacy.prepare(`INSERT INTO v2_import_provenance(desktop_session_key, platform_kind, source_session_key, source_session_id, platform_space_id, lifecycle, metadata_version, created_at_ms, updated_at_ms) VALUES (?, 'telegram', ?, NULL, NULL, 'active', 1, 1, 1)`).run("legacy-new", "src-1")).toThrow();
    legacy.close();

    const db = new Database(dbPath);
    migrateDatabase(db);
    expect(readSchemaVersion(db)).toBe(5);
    // Legacy tombstone row is preserved.
    const remaining = db.prepare(`SELECT desktop_session_key, lifecycle FROM v2_import_provenance`).all() as Array<{ desktop_session_key: string; lifecycle: string }>;
    expect(remaining).toEqual([{ desktop_session_key: "legacy-old", lifecycle: "local_delete_tombstone" }]);
    // After migration a second row per source is allowed as long as only one is active.
    const repo = new ImportProvenanceRepository(db);
    repo.upsert({ desktopSessionKey: "new-key", platformKind: "telegram", sourceSessionKey: "src-1", sourceSessionId: null, platformSpaceId: null, lifecycle: "active" });
    expect(repo.findAllByPlatformSource("telegram", "src-1").map((row) => ({ desktopSessionKey: row.desktopSessionKey, lifecycle: row.lifecycle })).sort((a, b) => a.desktopSessionKey.localeCompare(b.desktopSessionKey))).toEqual([
      { desktopSessionKey: "legacy-old", lifecycle: "local_delete_tombstone" },
      { desktopSessionKey: "new-key", lifecycle: "active" },
    ]);
    // The partial unique index forbids a second active row for the same source.
    expect(() => repo.upsert({ desktopSessionKey: "other-active", platformKind: "telegram", sourceSessionKey: "src-1", sourceSessionId: null, platformSpaceId: null, lifecycle: "active" })).not.toThrow();
    // The previous active row was demoted to tombstone by upsert, leaving exactly one active.
    expect(repo.findAllByPlatformSource("telegram", "src-1").filter((row) => row.lifecycle === "active")).toHaveLength(1);
    db.close();
  });

  test("a local delete tombstone prevents Gateway sync resurrection", async () => {
    const testConfig = config();
    const desktopSessionKey = "agent:main:desktop:migrated-discord-old";
    const sourceSessionKey = "agent:main:discord:guild:1:channel:2";
    const db = new Database(testConfig.databasePath);
    migrateDatabase(db);
    saveCompat(db, "spaces", [{ id: "space_discord", name: "Discord", archived: false, importedFrom: { kind: "discord", scope: "session-migration" } }]);
    saveCompat(db, "activeSpaceId", "space_discord");
    saveCompat(db, "sessions", [{ id: "session_1", sessionKey: desktopSessionKey, key: desktopSessionKey, spaceId: "space_discord", importedFrom: { kind: "discord", sourceSessionKey } }]);
    saveCompat(db, "chats", [{ id: "chat_1", sessionKey: desktopSessionKey, spaceId: "space_discord", importedFrom: { kind: "discord", sourceSessionKey } }]);
    db.close();

    const app = await createApp(testConfig);
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }; importProvenance: ImportProvenanceRepository } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => method === "sessions.list" ? { sessions: [{ key: desktopSessionKey, label: "Imported channel", agentId: "main" }] } : {});
    const deleted = await app.inject({ method: "DELETE", url: "/api/chats/chat_1" });
    expect(deleted.json()).toMatchObject({ localOnly: true });
    expect(context.gateway.request.mock.calls.some(([method]) => method === "sessions.delete")).toBe(false);
    expect(context.importProvenance.findByDesktopSessionKey(desktopSessionKey)?.lifecycle).toBe("local_delete_tombstone");
    const chats = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    expect(chats.json().chats).not.toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: desktopSessionKey })]));
    await app.close();
  });

  test("integration: revive path reuses desktop key, updates durable, skips sessions.create, and scan filter respects active provenance", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-integration-revive-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sourceSessionKey = "agent:main:telegram:group:-1002:topic:9";
    const sourceFile = path.join(sessionsDir, "topic-9.jsonl");
    const targetFile = path.join(sessionsDir, "imported-topic-9.jsonl");
    const meta = JSON.stringify({ chat_id: "telegram:-1002", topic_id: "9", group_subject: "Ops", topic_name: "Topic 9", is_group_chat: true });
    fs.writeFileSync(sourceFile, `${JSON.stringify({ type: "message", id: "m1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\nintegration payload` } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [sourceSessionKey]: { sessionId: "topic-9", sessionFile: sourceFile, chatType: "group", subject: "Ops" } }));

    const app = await createApp(config());
    const context = (app as typeof app & { v2Context: { db: Database.Database; importProvenance: ImportProvenanceRepository; gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    let desktopSessionKey = "";
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.create") {
        desktopSessionKey = String(params?.key);
        return { payload: { entry: { sessionFile: targetFile } }, label: params?.label };
      }
      if (method === "sessions.list") return { sessions: desktopSessionKey ? [{ key: desktopSessionKey, label: "Topic 9", agentId: "main" }] : [] };
      return {};
    });

    const first = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceSessionKey] } });
    const firstDesktopSessionKey = first.json().imported[0].desktopSessionKey as string;
    expect(firstDesktopSessionKey).toBe(desktopSessionKey);
    // C invariant: durable provenance active row exists
    expect(context.importProvenance.findByDesktopSessionKey(firstDesktopSessionKey)?.lifecycle).toBe("active");
    // Scan should mark this source as alreadyImported (active durable)
    const scanAfterImport = await app.inject({ method: "GET", url: "/api/migration/telegram/scan"});
    expect(scanAfterImport.json().sessions.find((s: { sourceSessionKey: string }) => s.sourceSessionKey === sourceSessionKey)).toMatchObject({ alreadyImported: true });

    // Delete → concurrent tombstone + durable tombstone
    const chatId = first.json().imported[0].chatId as string;
    await app.inject({ method: "DELETE", url: `/api/chats/${chatId}` });
    // Both tombstone mechanisms fired:
    expect(context.importProvenance.findByDesktopSessionKey(firstDesktopSessionKey)?.lifecycle).toBe("local_delete_tombstone");
    // Compat state records preserved with deleted=true so concurrent fast-path can recognise them
    const compatSessions = context.db.prepare("SELECT data_json FROM v2_compat_state WHERE key = 'sessions'").get() as { data_json: string } | undefined;
    const compatRecords = compatSessions ? JSON.parse(compatSessions.data_json) as CompatRow[] : [];
    expect(compatRecords.some((r) => r.sessionKey === firstDesktopSessionKey && r.deleted === true && r.importedFrom)).toBe(true);

    // Scan post-delete: source should now be re-importable (durable tombstoned, compat deleted)
    const scanAfterDelete = await app.inject({ method: "GET", url: "/api/migration/telegram/scan"});
    expect(scanAfterDelete.json().sessions.find((s: { sourceSessionKey: string }) => s.sourceSessionKey === sourceSessionKey)).toMatchObject({ alreadyImported: false });

    // Re-import: revive path must reuse original desktopSessionKey and NOT call sessions.create
    context.gateway.request.mockClear();
    const reimported = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceSessionKey] } });
    expect(reimported.json().imported[0]).toMatchObject({ desktopSessionKey: firstDesktopSessionKey, reusedTombstone: true });
    expect(context.gateway.request.mock.calls.filter(([method]) => method === "sessions.create")).toHaveLength(0);
    // Durable is flipped back to active on revive
    expect(context.importProvenance.findByDesktopSessionKey(firstDesktopSessionKey)?.lifecycle).toBe("active");

    // Post-reimport sync: exactly one chat row appears for that desktop key
    clearSyncGatewaySessionsCache();
    const bootstrap = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    const matching = bootstrap.json().chats.filter((c: { sessionKey?: string }) => c.sessionKey === firstDesktopSessionKey);
    expect(matching).toHaveLength(1);
    await app.close();
  });
});
