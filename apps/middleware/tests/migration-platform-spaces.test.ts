import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { clearSyncGatewaySessionsCache, clearBootstrapCacheForTests, forceReloadCompatStateForTests } from "../src/features/compat/routes.js";
import type { ImportProvenanceRepository } from "../src/features/migration/provenance-repository.js";

/**
 * Phase D coverage — marker-based dedicated imported platform spaces.
 *
 * Invariants (see docs/plans/2026-07-13-platform-import-reliability-system-design.md §D):
 *   - Platform space/project identity is marker-based (importedFrom.scope = "session-migration"),
 *     never display-name-based. A user-created workspace or project named "Telegram"/"Discord"
 *     must never be adopted as the imported platform target.
 *   - Imported chats live flat inside the marker space: spaceId = marker-space-id,
 *     projectId = null, topicId = null. Legacy nested (project + topic) imported structures
 *     migrate safely to that flat layout without producing duplicate spaces/chats.
 *   - Normalization must be idempotent and must reuse the existing marker space rather
 *     than allocating a fresh one on each pass.
 *   - This phase reuses Phase C's durable v2_import_provenance repository; it never opens
 *     a competing edit stream in compat/routes.ts. Provenance rows survive normalization.
 */

type CompatSpace = { id: string; name?: string; archived?: boolean; deleted?: boolean; sortOrder?: number; createdAt?: string; updatedAt?: string; importedFrom?: { kind?: string; scope?: string } };
type CompatProject = { id: string; name?: string; spaceId?: string; archived?: boolean; deleted?: boolean; sortOrder?: number; createdAt?: string; updatedAt?: string; importedFrom?: { kind?: string; scope?: string } };
type CompatTopic = { id: string; name?: string; projectId?: string; spaceId?: string; archived?: boolean; deleted?: boolean; sortOrder?: number; createdAt?: string; updatedAt?: string; importedFrom?: { kind?: string; sourceSessionKey?: string } };
type CompatSession = { id?: string; sessionKey?: string; key?: string; spaceId?: string; projectId?: string | null; topicId?: string | null; label?: string; agentId?: string; deleted?: boolean; archived?: boolean; hidden?: boolean; importedFrom?: { kind?: string; sourceSessionKey?: string } };
type CompatChat = { id?: string; sessionKey?: string; spaceId?: string; projectId?: string | null; topicId?: string | null; name?: string; deleted?: boolean; archived?: boolean; importedFrom?: { kind?: string; sourceSessionKey?: string } };

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-platform-spaces-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:1",
    nodeEnv: "test",
  };
}

function saveCompat(db: Database.Database, key: string, value: unknown) {
  db.prepare("INSERT INTO v2_compat_state(key, data_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, updated_at_ms = excluded.updated_at_ms")
    .run(key, JSON.stringify(value), Date.now());
}

function seed(testConfig: MiddlewareConfig, seedRows: {
  spaces?: CompatSpace[];
  projects?: CompatProject[];
  topics?: CompatTopic[];
  sessions?: CompatSession[];
  chats?: CompatChat[];
  activeSpaceId?: string;
}) {
  const db = new Database(testConfig.databasePath);
  migrateDatabase(db);
  if (seedRows.spaces) saveCompat(db, "spaces", seedRows.spaces);
  if (seedRows.projects) saveCompat(db, "projects", seedRows.projects);
  if (seedRows.topics) saveCompat(db, "topics", seedRows.topics);
  if (seedRows.sessions) saveCompat(db, "sessions", seedRows.sessions);
  if (seedRows.chats) saveCompat(db, "chats", seedRows.chats);
  if (seedRows.activeSpaceId) saveCompat(db, "activeSpaceId", seedRows.activeSpaceId);
  db.close();
}

type BootstrapResponse = {
  spaces: CompatSpace[];
  activeSpaceId: string;
  chats: CompatChat[];
  projects: CompatProject[];
  topics: CompatTopic[];
  sessions: CompatSession[];
};

async function bootstrap(app: Awaited<ReturnType<typeof createApp>>) {
  clearBootstrapCacheForTests();
  clearSyncGatewaySessionsCache();
  const response = await app.inject({ method: "GET", url: "/api/bootstrap" });
  expect(response.statusCode).toBe(200);
  return response.json() as BootstrapResponse;
}

function stubOfflineGateway(app: Awaited<ReturnType<typeof createApp>>) {
  const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }; importProvenance: ImportProvenanceRepository } }).v2Context;
  context.gateway.status = vi.fn(() => ({ connected: false, lastError: null }));
  context.gateway.request = vi.fn(async () => ({ sessions: [] }));
  return context;
}

afterEach(() => vi.restoreAllMocks());

describe("Phase D — marker-based dedicated platform spaces", () => {
  test("bootstrap normalization retires legacy imported project/topic and moves imported chats flat under the marker space", async () => {
    // Legacy layout: a previous release wrote the import into a Telegram project
    // + per-source topic. Phase D must migrate that in-place to the flat layout
    // without creating duplicate spaces or duplicate chats.
    const testConfig = config("legacy-nested-telegram");
    const desktopSessionKey = "agent:main:desktop:migrated-telegram-legacy";
    const sourceSessionKey = "agent:main:telegram:group:-1002:topic:9";
    seed(testConfig, {
      spaces: [
        { id: "space_default", name: "My Workspace", archived: false },
        { id: "space_tg_marker", name: "Telegram", archived: false, importedFrom: { kind: "telegram", scope: "session-migration" } },
      ],
      activeSpaceId: "space_default",
      projects: [{
        id: "project_tg_legacy",
        name: "Telegram",
        spaceId: "space_tg_marker",
        archived: false,
        importedFrom: { kind: "telegram", scope: "session-migration" },
      }],
      topics: [{
        id: "topic_tg_legacy",
        name: "Topic 9",
        projectId: "project_tg_legacy",
        spaceId: "space_tg_marker",
        archived: false,
        importedFrom: { kind: "telegram", sourceSessionKey },
      }],
      sessions: [{
        id: "session_tg_legacy",
        sessionKey: desktopSessionKey,
        key: desktopSessionKey,
        label: "Topic 9",
        agentId: "main",
        spaceId: "space_tg_marker",
        projectId: "project_tg_legacy",
        topicId: "topic_tg_legacy",
        importedFrom: { kind: "telegram", sourceSessionKey },
      }],
      chats: [{
        id: "chat_tg_legacy",
        sessionKey: desktopSessionKey,
        spaceId: "space_tg_marker",
        projectId: "project_tg_legacy",
        topicId: "topic_tg_legacy",
        name: "Topic 9",
        importedFrom: { kind: "telegram", sourceSessionKey },
      }],
    });

    const app = await createApp(testConfig);
    stubOfflineGateway(app);
    const first = await bootstrap(app);

    // The marker-based space is the single Telegram-marked space; no duplicate created.
    const telegramMarkerSpaces = first.spaces.filter((space) => space.importedFrom?.kind === "telegram" && space.importedFrom?.scope === "session-migration");
    expect(telegramMarkerSpaces).toHaveLength(1);
    expect(telegramMarkerSpaces[0].id).toBe("space_tg_marker");

    // The imported session is now flat: kept marker spaceId, cleared project/topic.
    // Query the marker space explicitly — bootstrap.sessions is scoped to the active space.
    const sessionsRes = await app.inject({ method: "GET", url: `/api/sessions?spaceId=space_tg_marker` });
    expect(sessionsRes.statusCode).toBe(200);
    const importedSession = (sessionsRes.json().sessions as CompatSession[]).find((session) => session.sessionKey === desktopSessionKey);
    expect(importedSession).toBeTruthy();
    expect(importedSession).toMatchObject({ spaceId: "space_tg_marker", projectId: null, topicId: null, importedFrom: { kind: "telegram", sourceSessionKey } });

    // A second bootstrap must be idempotent: no new spaces/projects/topics/chats.
    const second = await bootstrap(app);
    expect(second.spaces.filter((space) => space.importedFrom?.kind === "telegram" && space.importedFrom?.scope === "session-migration")).toHaveLength(1);
    // Retired legacy imported project/topic no longer appear in visible bootstrap lists.
    expect(second.projects.some((project) => project.id === "project_tg_legacy")).toBe(false);
    expect(second.topics.some((topic) => topic.id === "topic_tg_legacy")).toBe(false);

    // Query the marker space directly and confirm exactly one imported chat lives there,
    // flat, with the durable source linkage preserved.
    const chatsRes = await app.inject({ method: "GET", url: `/api/chats?spaceId=space_tg_marker` });
    expect(chatsRes.statusCode).toBe(200);
    const importedChats = (chatsRes.json().chats as CompatChat[]).filter((chat) => chat.importedFrom?.kind === "telegram" && chat.importedFrom?.sourceSessionKey === sourceSessionKey);
    expect(importedChats).toHaveLength(1);
    expect(importedChats[0]).toMatchObject({ spaceId: "space_tg_marker", projectId: null, topicId: null });

    await app.close();
  });

  test("bootstrap never adopts a user-created space named 'Discord' as the imported Discord platform space", async () => {
    // Discord counterpart to the existing Telegram direct-import non-adoption test.
    // A legacy imported Discord session exists in a random pre-marker space; bootstrap
    // normalization must ALLOCATE a new marker-tagged space rather than adopt the
    // user's "Discord" space that shares the same display name.
    const testConfig = config("no-adopt-discord-user-space");
    const desktopSessionKey = "agent:main:desktop:migrated-discord-legacy";
    const sourceSessionKey = "agent:main:discord:guild:1:channel:2";
    seed(testConfig, {
      spaces: [
        { id: "space_default", name: "My Workspace", archived: false },
        { id: "space_user_discord", name: "Discord", archived: false },
      ],
      activeSpaceId: "space_default",
      sessions: [{
        id: "session_dc_legacy",
        sessionKey: desktopSessionKey,
        key: desktopSessionKey,
        label: "channel-2",
        agentId: "main",
        spaceId: "space_user_discord", // stale/legacy: pointed at same-named user space
        importedFrom: { kind: "discord", sourceSessionKey },
      }],
      chats: [{
        id: "chat_dc_legacy",
        sessionKey: desktopSessionKey,
        spaceId: "space_user_discord",
        name: "channel-2",
        importedFrom: { kind: "discord", sourceSessionKey },
      }],
    });

    const app = await createApp(testConfig);
    stubOfflineGateway(app);
    const response = await bootstrap(app);

    // User's same-named Discord space is preserved with its original id and no marker.
    const userDiscordSpace = response.spaces.find((space) => space.id === "space_user_discord");
    expect(userDiscordSpace).toBeTruthy();
    expect(userDiscordSpace?.importedFrom).toBeUndefined();

    // A distinct marker-tagged Discord platform space now exists.
    const markerDiscordSpaces = response.spaces.filter((space) => space.importedFrom?.kind === "discord" && space.importedFrom?.scope === "session-migration");
    expect(markerDiscordSpaces).toHaveLength(1);
    expect(markerDiscordSpaces[0].id).not.toBe("space_user_discord");

    // The imported session was migrated into the marker space, flat.
    const sessionsRes = await app.inject({ method: "GET", url: `/api/sessions?spaceId=${markerDiscordSpaces[0].id}` });
    const importedSession = (sessionsRes.json().sessions as CompatSession[]).find((session) => session.sessionKey === desktopSessionKey);
    expect(importedSession).toBeTruthy();
    expect(importedSession).toMatchObject({ spaceId: markerDiscordSpaces[0].id, projectId: null, topicId: null, importedFrom: { kind: "discord", sourceSessionKey } });

    await app.close();
  });

  test("existing marker-tagged platform space is reused (never duplicated) even when the user renames it", async () => {
    // Identity is the marker (importedFrom.kind + scope), not the display name.
    // Renaming the marker space by the user must not cause the next normalization
    // pass to allocate a fresh marker space.
    const testConfig = config("marker-identity-rename");
    const desktopSessionKey = "agent:main:desktop:migrated-telegram-renamed";
    const sourceSessionKey = "agent:main:telegram:group:-42:topic:7";
    seed(testConfig, {
      spaces: [
        { id: "space_default", name: "My Workspace", archived: false },
        { id: "space_tg_marker", name: "My Telegram Archive", archived: false, importedFrom: { kind: "telegram", scope: "session-migration" } },
      ],
      activeSpaceId: "space_default",
      sessions: [{
        id: "session_tg_renamed",
        sessionKey: desktopSessionKey,
        key: desktopSessionKey,
        label: "Topic 7",
        agentId: "main",
        spaceId: "space_tg_marker",
        projectId: null,
        topicId: null,
        importedFrom: { kind: "telegram", sourceSessionKey },
      }],
      chats: [{
        id: "chat_tg_renamed",
        sessionKey: desktopSessionKey,
        spaceId: "space_tg_marker",
        name: "Topic 7",
        importedFrom: { kind: "telegram", sourceSessionKey },
      }],
    });

    const app = await createApp(testConfig);
    stubOfflineGateway(app);
    const first = await bootstrap(app);
    const marker = first.spaces.filter((space) => space.importedFrom?.kind === "telegram" && space.importedFrom?.scope === "session-migration");
    expect(marker).toHaveLength(1);
    expect(marker[0].id).toBe("space_tg_marker");
    // Presentation label is normalized back to the platform name so the space
    // stays discoverable; identity remains the marker.
    expect(marker[0].name).toBe("Telegram");

    const second = await bootstrap(app);
    const markerAgain = second.spaces.filter((space) => space.importedFrom?.kind === "telegram" && space.importedFrom?.scope === "session-migration");
    expect(markerAgain).toHaveLength(1);
    expect(markerAgain[0].id).toBe("space_tg_marker");

    await app.close();
  });

  test("normalization deduplicates concurrent imported chats and preserves durable provenance for the source", async () => {
    // Reset+resync races historically produced two live chat rows for the same
    // source. Phase D's normalize path dedupes them into one flat chat under
    // the marker space, and Phase C's provenance row for that source stays intact.
    const testConfig = config("dedupe-concurrent-imports");
    const desktopSessionKey = "agent:main:desktop:migrated-telegram-dupe";
    const sourceSessionKey = "agent:main:telegram:group:-77:topic:1";
    seed(testConfig, {
      spaces: [
        { id: "space_default", name: "My Workspace", archived: false },
        { id: "space_tg_marker", name: "Telegram", archived: false, importedFrom: { kind: "telegram", scope: "session-migration" } },
      ],
      activeSpaceId: "space_default",
      sessions: [{
        id: "session_tg_dupe",
        sessionKey: desktopSessionKey,
        key: desktopSessionKey,
        label: "Topic 1",
        agentId: "main",
        spaceId: "space_tg_marker",
        projectId: null,
        topicId: null,
        importedFrom: { kind: "telegram", sourceSessionKey },
      }],
      chats: [
        { id: "chat_tg_dupe_a", sessionKey: desktopSessionKey, spaceId: "space_tg_marker", name: "Topic 1", importedFrom: { kind: "telegram", sourceSessionKey } },
        { id: "chat_tg_dupe_b", sessionKey: desktopSessionKey, spaceId: "space_tg_marker", name: "Topic 1", importedFrom: { kind: "telegram", sourceSessionKey } },
      ],
    });

    const app = await createApp(testConfig);
    const context = stubOfflineGateway(app);
    // Phase C backfill ran during createApp; the durable provenance row should
    // already exist for the seeded importedFrom compat rows.
    expect(context.importProvenance.findByPlatformSource("telegram", sourceSessionKey)).toMatchObject({ desktopSessionKey, platformKind: "telegram", lifecycle: "active" });

    await bootstrap(app);

    const chatsRes = await app.inject({ method: "GET", url: `/api/chats?all=true` });
    const liveChats = (chatsRes.json().chats as CompatChat[]).filter((chat) => chat.importedFrom?.kind === "telegram" && chat.importedFrom?.sourceSessionKey === sourceSessionKey && !chat.deleted);
    expect(liveChats).toHaveLength(1);
    expect(liveChats[0]).toMatchObject({ spaceId: "space_tg_marker", projectId: null, topicId: null });

    // Durable provenance stays authoritative for the source session key.
    const provenance = context.importProvenance.findByPlatformSource("telegram", sourceSessionKey);
    expect(provenance).toMatchObject({ desktopSessionKey, platformKind: "telegram", lifecycle: "active" });

    await app.close();
  });

  test("normalization is a no-op when there are no imported records for a platform", async () => {
    // Guard: normalization must not create the marker space until an actual
    // imported record for that platform exists. This preserves 'clean install'
    // sidebars for users who never import.
    const testConfig = config("no-imports-no-marker-space");
    seed(testConfig, {
      spaces: [{ id: "space_default", name: "My Workspace", archived: false }],
      activeSpaceId: "space_default",
    });

    const app = await createApp(testConfig);
    stubOfflineGateway(app);
    const response = await bootstrap(app);
    expect(response.spaces.some((space) => space.importedFrom?.kind === "telegram" && space.importedFrom?.scope === "session-migration")).toBe(false);
    expect(response.spaces.some((space) => space.importedFrom?.kind === "discord" && space.importedFrom?.scope === "session-migration")).toBe(false);
    await app.close();
  });

  test("Gateway resync of a legacy migrated- session with import metadata reuses the existing marker space rather than adopting a same-named user space", async () => {
    // Gateway restore path (Phase C runtime + D placement). The Gateway list
    // includes a migrated-* session whose metadata identifies it as a Telegram
    // import. Bootstrap must place it under the marker space, not the user's
    // pre-existing "Telegram" workspace.
    const testConfig = config("gateway-resync-into-marker");
    const desktopSessionKey = "agent:main:desktop:migrated-telegram-resync";
    const sourceSessionKey = "agent:main:telegram:group:-500:topic:3";
    seed(testConfig, {
      spaces: [
        { id: "space_default", name: "My Workspace", archived: false },
        { id: "space_user_telegram", name: "Telegram", archived: false },
      ],
      activeSpaceId: "space_default",
    });

    const app = await createApp(testConfig);
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> }; importProvenance: ImportProvenanceRepository } }).v2Context;
    // Seed durable provenance directly so Gateway sync can resolve placement
    // without depending on Phase C's separate backfill test surface.
    context.importProvenance.upsert({
      desktopSessionKey,
      platformKind: "telegram",
      sourceSessionKey,
      sourceSessionId: null,
      platformSpaceId: null,
      lifecycle: "active",
    });
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => method === "sessions.list"
      ? { sessions: [{ key: desktopSessionKey, label: "Imported topic", agentId: "main", metadata: { openclawDesktop: { migration: { version: 1, platform: "telegram", sourceSessionKey } } } }] }
      : {});

    forceReloadCompatStateForTests(context as unknown as import("../src/app.js").AppContext);
    const response = await bootstrap(app);

    // The user's "Telegram" workspace was NOT adopted.
    const userSpace = response.spaces.find((space) => space.id === "space_user_telegram");
    expect(userSpace).toBeTruthy();
    expect(userSpace?.importedFrom).toBeUndefined();

    // A distinct marker-tagged Telegram platform space now exists.
    const marker = response.spaces.filter((space) => space.importedFrom?.kind === "telegram" && space.importedFrom?.scope === "session-migration");
    expect(marker).toHaveLength(1);
    expect(marker[0].id).not.toBe("space_user_telegram");

    // The resynced session is flat inside the marker space.
    const sessionsRes = await app.inject({ method: "GET", url: `/api/sessions?spaceId=${marker[0].id}` });
    const importedSession = (sessionsRes.json().sessions as CompatSession[]).find((session) => session.sessionKey === desktopSessionKey);
    expect(importedSession).toMatchObject({ spaceId: marker[0].id, projectId: null, topicId: null });

    await app.close();
  });
});
