import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import { loadEnv, type MiddlewareConfig } from "../src/config/env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";

function testConfig(overrides: Partial<MiddlewareConfig> = {}): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-middleware-app-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:1",
    nodeEnv: "test",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware app", () => {
  test("defaults to the legacy middleware port", () => {
    expect(loadEnv({ HOME: "/tmp/openclaw-test" } as NodeJS.ProcessEnv).port).toBe(8787);
  });

  test("health returns service metadata and legacy OpenClaw connection alias", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: "openclaw-middleware",
      gateway: { connected: expect.any(Boolean) },
      openclaw: { gatewayUrl: "ws://127.0.0.1:1", connected: expect.any(Boolean) },
      pairing: { enabled: true },
    });
    await app.close();
  });

  test("system info exposes configured v2 port", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/api/system/info" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, port: 8787 });
    await app.close();
  });

  test("legacy bootstrap compatibility route returns startup payload", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: "openclaw-middleware",
      activeSpaceId: "space_default",
      chats: [],
      projects: [],
      sessions: [],
    });
    await app.close();
  });

  test("legacy version compatibility route identifies v2", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/api/version" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "openclaw-middleware" });
    await app.close();
  });

  test("command compatibility returns real version info and rejects unknown commands", async () => {
    const app = await createApp(testConfig());
    const version = await app.inject({ method: "POST", url: "/api/commands/middleware_version_info", payload: { input: {} } });
    expect(version.statusCode).toBe(200);
    expect(version.json()).toMatchObject({ ok: true, service: "openclaw-middleware", nodeVersion: process.version });

    const unknown = await app.inject({ method: "POST", url: "/api/commands/middleware_unknown_future_command", payload: { input: {} } });
    expect(unknown.statusCode).toBe(501);
    expect(unknown.json()).toMatchObject({ ok: false });
    await app.close();
  });

  test("skill commands return structured 400 errors for invalid inputs", async () => {
    const app = await createApp(testConfig());

    const missingSlug = await app.inject({ method: "POST", url: "/api/commands/middleware_skills_detail", payload: { input: {} } });
    expect(missingSlug.statusCode).toBe(400);
    expect(missingSlug.json()).toMatchObject({ ok: false, error: { code: "INVALID_SKILL_INPUT", message: "slug is required" } });

    const unsupportedSource = await app.inject({ method: "POST", url: "/api/skills/install", payload: { source: "unknown" } });
    expect(unsupportedSource.statusCode).toBe(400);
    expect(unsupportedSource.json()).toMatchObject({ ok: false, error: { code: "INVALID_SKILL_INPUT", message: "Unsupported skill source: unknown" } });
    await app.close();
  });

  test("pins command compatibility persists by session", async () => {
    const app = await createApp(testConfig());
    const add = await app.inject({ method: "POST", url: "/api/commands/middleware_pins_add", payload: { input: { sessionKey: "s1", messageId: "m1", messageText: "hello" } } });
    expect(add.statusCode).toBe(200);
    expect(add.json()).toMatchObject({ ok: true, pin: { sessionKey: "s1", messageId: "m1" } });

    const list = await app.inject({ method: "POST", url: "/api/commands/middleware_pins_list", payload: { input: { sessionKey: "s1" } } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ pins: [expect.objectContaining({ messageId: "m1", messageText: "hello" })] });

    const remove = await app.inject({ method: "POST", url: "/api/commands/middleware_pins_remove", payload: { input: { sessionKey: "s1", messageId: "m1" } } });
    expect(remove.statusCode).toBe(200);
    expect(remove.json()).toMatchObject({ ok: true, removed: 1 });
    await app.close();
  });

  test("project workspace compatibility mirrors global workspace routes", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-project-workspace-"));
    const app = await createApp(testConfig());
    const project = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Workspace", workspaceRoot: root } });
    const projectId = project.json().project.id as string;

    const capabilities = await app.inject({ method: "GET", url: `/api/projects/${projectId}/workspace/capabilities` });
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json()).toMatchObject({ capabilities: { canRead: true, canWrite: true } });

    const write = await app.inject({ method: "PUT", url: `/api/projects/${projectId}/workspace/file`, payload: { path: "notes/a.txt", content: "hello" } });
    expect(write.statusCode).toBe(200);

    const stat = await app.inject({ method: "GET", url: `/api/projects/${projectId}/workspace/stat?path=notes/a.txt` });
    expect(stat.statusCode).toBe(200);
    expect(stat.json()).toMatchObject({ entry: { path: "notes/a.txt", type: "file" } });

    const mkdir = await app.inject({ method: "POST", url: `/api/projects/${projectId}/workspace/mkdir`, payload: { path: "other" } });
    expect(mkdir.statusCode).toBe(200);
    const move = await app.inject({ method: "POST", url: `/api/projects/${projectId}/workspace/move`, payload: { fromPath: "notes/a.txt", toPath: "other/b.txt" } });
    expect(move.statusCode).toBe(200);
    const del = await app.inject({ method: "DELETE", url: `/api/projects/${projectId}/workspace/file?path=other/b.txt` });
    expect(del.statusCode).toBe(200);
    await app.close();
  });

  test("old chat send command forwards to Gateway instead of fake success", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async () => ({ runId: "run-1" }));
    const res = await app.inject({ method: "POST", url: "/api/commands/middleware_chat_send", payload: { input: { sessionKey: "s1", message: "hello" } } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, sessionKey: "s1" });
    expect(context.gateway.request).toHaveBeenCalledWith("chat.send", expect.objectContaining({ sessionKey: "s1", message: "hello" }), 130_000);
    await app.close();
  });

  test("new chat returns a usable sessionKey", async () => {
    const app = await createApp(testConfig());
    const uniqueName = `Hello ${Date.now()}`;
    const res = await app.inject({ method: "POST", url: "/api/chats", payload: { name: uniqueName, agentId: "main" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.chat.sessionKey).toMatch(/^agent:main:desktop:/);
    expect(body.session.key).toBe(body.chat.sessionKey);
    expect(body.session.sessionKey).toBe(body.chat.sessionKey);
    await app.close();
  });

  test("deleting a chat hides chat, removes compat session, and clears v2 session data", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> }, db: Database.Database } }).v2Context;
    context.gateway.request = vi.fn(async () => ({ ok: true }));

    const createRes = await app.inject({ method: "POST", url: "/api/chats", payload: { name: "Delete me", agentId: "main" } });
    const created = createRes.json();
    const chatId = created.chat.id as string;
    const sessionKey = created.chat.sessionKey as string;
    context.db.prepare("INSERT INTO v2_sessions(session_key, session_id, data_json, updated_at_ms) VALUES (?, ?, ?, ?)").run(sessionKey, "session_id", "{}", Date.now());
    context.db.prepare("INSERT INTO v2_messages(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)").run(sessionKey, 1, "msg_1", "user", "{}", Date.now());

    const deleteRes = await app.inject({ method: "DELETE", url: `/api/chats/${chatId}`, headers: { "content-type": "application/json" } });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toMatchObject({ ok: true, chatId, sessionKey });

    const chats = await app.inject({ method: "GET", url: "/api/chats?spaceId=space_default" });
    expect(chats.json().chats.some((chat: { id: string }) => chat.id === chatId)).toBe(false);
    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(sessions.json().sessions.some((session: { sessionKey?: string; key?: string }) => session.sessionKey === sessionKey || session.key === sessionKey)).toBe(false);
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_sessions WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 0 });
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_messages WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 0 });
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.delete", { key: sessionKey, deleteTranscript: true }, 2_000);
    await app.close();
  });

  test("voice settings commands read/write config and provider access", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-voice-settings-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const app = await createApp(testConfig());

    const initial = await app.inject({ method: "POST", url: "/api/commands/middleware_voice_settings_get", payload: { input: {} } });
    expect(initial.statusCode).toBe(200);
    expect(initial.json()).toMatchObject({ settings: { provider: "auto", model: "", enabled: true } });

    const saved = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_voice_settings_set",
      payload: { input: { provider: "openai", model: "whisper-1", language: "en", echoTranscript: true } },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ settings: { provider: "openai", model: "whisper-1", language: "en", echoTranscript: true } });

    const details = await app.inject({ method: "POST", url: "/api/commands/middleware_onboarding_provider_details", payload: { input: { providerId: "openai" } } });
    expect(details.statusCode).toBe(200);
    expect(details.json()).toMatchObject({ provider: { id: "openai", authMethods: ["api-key"] } });

    const access = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_onboarding_provider_submit",
      payload: { input: { providerId: "openai", values: { "api-key": "sk-test" } } },
    });
    expect(access.statusCode).toBe(200);
    expect(access.json()).toMatchObject({ ok: true, envVar: "OPENAI_API_KEY" });

    const config = JSON.parse(fs.readFileSync(path.join(home, ".openclaw", "openclaw.json"), "utf8"));
    expect(config).toMatchObject({
      tools: { media: { audio: { language: "en", echoTranscript: true, models: [{ provider: "openai", model: "whisper-1" }] } } },
      env: { vars: { OPENAI_API_KEY: "sk-test" } },
    });
    await app.close();
  });

  test("notification cron commands create, list, update, and delete jobs", async () => {
    const app = await createApp(testConfig());

    const created = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_cron_create_job",
      payload: { input: { name: "Morning check", scheduleType: "cron", schedule: "0 9 * * *", timezone: "Asia/Kolkata", message: "What changed?", enabled: true } },
    });
    expect(created.statusCode).toBe(200);
    const jobId = created.json().jobId as string;
    expect(created.json()).toMatchObject({ job: { jobId, name: "Morning check", enabled: true, paused: false } });

    const listed = await app.inject({ method: "POST", url: "/api/commands/middleware_cron_list_jobs", payload: { input: {} } });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().jobs).toEqual(expect.arrayContaining([expect.objectContaining({ jobId, name: "Morning check" })]));

    const updated = await app.inject({ method: "POST", url: "/api/commands/middleware_cron_update_job", payload: { input: { jobId, enabled: false, name: "Paused check" } } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ job: { jobId, name: "Paused check", enabled: false, paused: true, status: "paused" } });

    const activity = await app.inject({ method: "POST", url: "/api/commands/middleware_cron_recent_activity", payload: { input: { limit: 10 } } });
    expect(activity.statusCode).toBe(200);
    expect(activity.json()).toMatchObject({ events: [] });

    const deleted = await app.inject({ method: "POST", url: "/api/commands/middleware_cron_delete_job", payload: { input: { jobId } } });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ ok: true });
    await app.close();
  });

  test("memory commands read, write, list, store, and recall workspace files", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-memory-settings-"));
    const workspace = path.join(home, ".openclaw", "workspace");
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, "SOUL.md"), "# Soul\n\nHelpful.", "utf8");
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const app = await createApp(testConfig());

    const readRes = await app.inject({ method: "POST", url: "/api/commands/middleware_memory_read", payload: { input: { path: "SOUL.md" } } });
    expect(readRes.statusCode).toBe(200);
    expect(readRes.json()).toMatchObject({ content: "# Soul\n\nHelpful." });

    const writeRes = await app.inject({ method: "POST", url: "/api/commands/middleware_memory_write", payload: { input: { path: "USER.md", content: "Krish" } } });
    expect(writeRes.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(workspace, "USER.md"), "utf8")).toBe("Krish");

    const listRes = await app.inject({ method: "POST", url: "/api/commands/middleware_memory_list", payload: { input: {} } });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().documents.map((doc: { path: string }) => doc.path)).toEqual(expect.arrayContaining(["SOUL.md", "USER.md"]));

    const storeRes = await app.inject({ method: "POST", url: "/api/commands/middleware_memory_store", payload: { input: { content: "Remember this", category: "fact" } } });
    expect(storeRes.statusCode).toBe(200);
    expect(storeRes.json().path).toMatch(/^memory\/\d{4}-\d{2}-\d{2}\.md$/);

    const recallRes = await app.inject({ method: "POST", url: "/api/commands/middleware_memory_recall", payload: { input: {} } });
    expect(recallRes.statusCode).toBe(200);
    expect(recallRes.json().entries.length).toBeGreaterThan(0);
    await app.close();
  });

  test("middleware_chats_delete command fallback deletes chats instead of returning fake success", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async () => ({ ok: true }));
    const createRes = await app.inject({ method: "POST", url: "/api/chats", payload: { name: "Command delete", agentId: "main" } });
    const chatId = createRes.json().chat.id as string;

    const deleteRes = await app.inject({ method: "POST", url: "/api/commands/middleware_chats_delete", payload: { input: { chatId } } });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toMatchObject({ ok: true, chatId });
    const missingDeleteRes = await app.inject({ method: "DELETE", url: "/api/chats/chat_missing" });
    expect(missingDeleteRes.statusCode).toBe(200);
    expect(missingDeleteRes.json()).toMatchObject({ ok: true, chatId: "chat_missing", sessionKey: null });
    const chats = await app.inject({ method: "GET", url: "/api/chats?spaceId=space_default" });
    expect(chats.json().chats.some((chat: { id: string }) => chat.id === chatId)).toBe(false);
    await app.close();
  });

  test("cors preflight allows browser delete chat requests", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/chats/chat_1",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "DELETE",
        "access-control-request-headers": "authorization,content-type,x-requested-with",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(String(res.headers["access-control-allow-methods"])).toContain("DELETE");
    const allowedHeaders = String(res.headers["access-control-allow-headers"]).toLowerCase();
    expect(allowedHeaders).toContain("authorization");
    expect(allowedHeaders).toContain("content-type");
    expect(allowedHeaders).toContain("x-requested-with");
    await app.close();
  });

  test("new session returns both key and sessionKey aliases", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "POST", url: "/api/sessions", payload: { label: "Hello", agentId: "main" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.key).toMatch(/^agent:main:desktop:/);
    expect(body.session.sessionKey).toBe(body.session.key);
    await app.close();
  });

  test("attaching a session recreates missing chat shell", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "POST", url: "/api/chats/chat_missing/session", payload: { sessionKey: "agent:main:desktop:test" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ chat: { id: "chat_missing", sessionKey: "agent:main:desktop:test" } });
    await app.close();
  });

  test("migrates v1 SQLite compat state into v2", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-v1-sqlite-migration-"));
    const sourcePath = path.join(root, "state.sqlite");
    const db = new Database(sourcePath);
    const timestamp = new Date().toISOString();
    const v1State = {
      spaces: [{ id: "space_v1", name: "V1 Space", archived: false, deleted: false, sortOrder: 0, createdAt: timestamp, updatedAt: timestamp }],
      activeSpaceId: "space_v1",
      chats: [{ id: "chat_v1", name: "V1 Chat", sessionKey: "agent:main:desktop:v1", spaceId: "space_v1", createdAt: timestamp, updatedAt: timestamp }],
      projects: [{ id: "proj_v1", name: "V1 Project", workspaceRoot: root, repoRoot: root, spaceId: "space_v1", createdAt: timestamp, updatedAt: timestamp }],
      topics: [{ id: "topic_v1", projectId: "proj_v1", name: "V1 Topic", createdAt: timestamp, updatedAt: timestamp }],
      sessions: [{ id: "session_v1", sessionKey: "agent:main:desktop:v1", key: "agent:main:desktop:v1", label: "V1 Chat", createdAt: timestamp, updatedAt: timestamp }],
      commandState: { ignored: true },
    };
    db.exec("CREATE TABLE kv_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.prepare("INSERT INTO kv_state(key, value, updated_at) VALUES ('state', ?, ?)").run(JSON.stringify(v1State), timestamp);
    db.close();

    const app = await createApp(testConfig());
    const res = await app.inject({ method: "POST", url: "/api/migration/v1-sqlite/import", payload: { sourcePath } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, sourcePath, summary: { imported: 5, updated: 0, spaces: 1, chats: 1, projects: 1, topics: 1, sessions: 1 } });

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(bootstrap.json()).toMatchObject({ activeSpaceId: "space_v1" });
    expect(bootstrap.json().chats).toEqual(expect.arrayContaining([expect.objectContaining({ id: "chat_v1", name: "V1 Chat" })]));
    expect(bootstrap.json().projects).toEqual(expect.arrayContaining([expect.objectContaining({ id: "proj_v1", name: "V1 Project" })]));

    const second = await app.inject({ method: "POST", url: "/api/migration/v1-sqlite/import", payload: { sourcePath } });
    expect(second.json()).toMatchObject({ summary: { imported: 0, updated: 5 } });
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("bootstrap imports Gateway sessions so a second device renders account chats", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { connect: unknown; status: unknown; request: unknown } } }).v2Context;
    context.gateway.connect = vi.fn(async () => undefined);
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            {
              key: "agent:main:desktop:shared",
              label: "Shared Chat",
              agentId: "main",
              createdAt: "2026-05-13T05:00:00.000Z",
              updatedAt: "2026-05-13T05:30:00.000Z",
            },
            {
              key: "agent:main:desktop:migrated-telegram-123",
              label: "Migrated Telegram Topic",
              agentId: "main",
              parentSessionKey: "agent:main:telegram:group:-1001:topic:42",
              createdAt: "2026-05-13T05:45:00.000Z",
              updatedAt: "2026-05-13T05:50:00.000Z",
            },
            {
              key: "agent:main:telegram:group:-1001:topic:42",
              label: "Telegram Topic",
              agentId: "main",
              createdAt: "2026-05-13T06:00:00.000Z",
              updatedAt: "2026-05-13T06:30:00.000Z",
            },
            {
              key: "agent:main:discord:guild:1:channel:2",
              label: "Discord Channel",
              agentId: "main",
              createdAt: "2026-05-13T07:00:00.000Z",
              updatedAt: "2026-05-13T07:30:00.000Z",
            },
          ],
        };
      }
      return {};
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Shared Chat", sessionKey: "agent:main:desktop:shared", spaceId: "space_default" }),
      expect.objectContaining({ name: "Migrated Telegram Topic", sessionKey: "agent:main:desktop:migrated-telegram-123", spaceId: "space_default" }),
    ]));
    expect(bootstrap.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: "agent:main:telegram:group:-1001:topic:42" }),
      expect.objectContaining({ sessionKey: "agent:main:discord:guild:1:channel:2" }),
    ]));
    expect(bootstrap.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Shared Chat", sessionKey: "agent:main:desktop:shared", spaceId: "space_default" }),
      expect.objectContaining({ label: "Migrated Telegram Topic", sessionKey: "agent:main:desktop:migrated-telegram-123", spaceId: "space_default" }),
    ]));
    expect(bootstrap.json().sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: "agent:main:telegram:group:-1001:topic:42" }),
      expect.objectContaining({ sessionKey: "agent:main:discord:guild:1:channel:2" }),
    ]));

    const chats = await app.inject({ method: "GET", url: "/api/chats?spaceId=space_default" });
    expect(chats.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Shared Chat", sessionKey: "agent:main:desktop:shared" }),
      expect.objectContaining({ name: "Migrated Telegram Topic", sessionKey: "agent:main:desktop:migrated-telegram-123" }),
    ]));
    expect(chats.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: "agent:main:telegram:group:-1001:topic:42" }),
      expect.objectContaining({ sessionKey: "agent:main:discord:guild:1:channel:2" }),
    ]));
    await app.close();
  });

  test("bootstrap removes stale gateway-only non-desktop sessions from old syncs", async () => {
    const config = testConfig();
    const first = await createApp(config);
    await first.close();

    const staleTelegramKey = "agent:main:telegram:group:-1001:topic:42";
    const staleDesktopKey = "agent:main:desktop:local-stale";
    const stableId = (prefix: string, value: string) => `${prefix}_${crypto.createHash("sha1").update(value).digest("hex").slice(0, 16)}`;
    const db = new Database(config.databasePath);
    const timestamp = Date.now();
    const save = db.prepare("INSERT INTO v2_compat_state(key, data_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, updated_at_ms = excluded.updated_at_ms");
    save.run("spaces", JSON.stringify([{ id: "space_default", name: "My Workspace", archived: false }]), timestamp);
    save.run("activeSpaceId", JSON.stringify("space_default"), timestamp);
    save.run("chats", JSON.stringify([
      { id: stableId("chat", staleTelegramKey), name: "Old Telegram", sessionKey: staleTelegramKey, spaceId: "space_default" },
      { id: stableId("chat", staleDesktopKey), name: "Local Desktop", sessionKey: staleDesktopKey, spaceId: "space_default" },
    ]), timestamp);
    save.run("sessions", JSON.stringify([
      { id: stableId("session", staleTelegramKey), key: staleTelegramKey, sessionKey: staleTelegramKey, label: "Old Telegram", spaceId: "space_default" },
      { id: stableId("session", staleDesktopKey), key: staleDesktopKey, sessionKey: staleDesktopKey, label: "Local Desktop", spaceId: "space_default" },
    ]), timestamp);
    db.close();

    const app = await createApp(config);
    const context = (app as typeof app & { v2Context: { gateway: { connect: unknown; status: unknown; request: unknown } } }).v2Context;
    context.gateway.connect = vi.fn(async () => undefined);
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => method === "sessions.list" ? { sessions: [{ key: staleDesktopKey, label: "Local Desktop", agentId: "main" }] } : {});

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(bootstrap.json().chats).not.toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: staleTelegramKey })]));
    expect(bootstrap.json().sessions).not.toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: staleTelegramKey })]));
    expect(bootstrap.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: staleDesktopKey })]));

    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(sessions.json().sessions).not.toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: staleTelegramKey })]));
    expect(sessions.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: staleDesktopKey })]));
    await app.close();
  });

  test("gateway sync keeps project topic sessions out of default standalone chats", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { connect: unknown; status: unknown; request: unknown } } }).v2Context;
    const sessionKey = "agent:main:desktop:topic-session";
    context.gateway.connect = vi.fn(async () => undefined);
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            {
              key: sessionKey,
              label: "Topic Session From Gateway",
              agentId: "main",
              projectId: null,
              topicId: null,
              createdAt: "2026-05-21T08:00:00.000Z",
              updatedAt: "2026-05-21T08:30:00.000Z",
            },
          ],
        };
      }
      return { session: { key: sessionKey, sessionKey } };
    });

    const project = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Project A", spaceId: "space_default" } });
    const projectId = project.json().project.id;
    const topic = await app.inject({ method: "POST", url: "/api/topics", payload: { projectId, name: "Topic A" } });
    const topicId = topic.json().topic.id;
    const created = await app.inject({ method: "POST", url: "/api/sessions", payload: { sessionKey, projectId, topicId, label: "Topic A" } });
    expect(created.statusCode).toBe(200);

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });

    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey }),
    ]));
    expect(bootstrap.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey, projectId, topicId, spaceId: "space_default" }),
    ]));

    const defaultChats = await app.inject({ method: "GET", url: "/api/chats?spaceId=space_default" });
    expect(defaultChats.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey }),
    ]));
    const topicSessions = await app.inject({ method: "GET", url: `/api/sessions?projectId=${projectId}&topicId=${topicId}` });
    expect(topicSessions.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey, label: "Topic A" }),
    ]));
    await app.close();
  });

  test("gateway sync removes previously mirrored ghost chats for topic sessions", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { connect: unknown; status: unknown; request: unknown } } }).v2Context;
    const sessionKey = "agent:main:desktop:topic-ghost";
    context.gateway.connect = vi.fn(async () => undefined);
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            {
              key: sessionKey,
              label: "Ghost Topic Session",
              agentId: "main",
              projectId: null,
              topicId: null,
              createdAt: "2026-05-21T09:00:00.000Z",
              updatedAt: "2026-05-21T09:30:00.000Z",
            },
          ],
        };
      }
      return { session: { key: sessionKey, sessionKey } };
    });

    const firstBootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(firstBootstrap.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey, name: "Ghost Topic Session" }),
    ]));

    const project = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Project B", spaceId: "space_default" } });
    const projectId = project.json().project.id;
    const topic = await app.inject({ method: "POST", url: "/api/topics", payload: { projectId, name: "Topic B" } });
    const topicId = topic.json().topic.id;
    await app.inject({ method: "POST", url: "/api/sessions", payload: { sessionKey, projectId, topicId, label: "Topic B" } });

    const secondBootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });

    expect(secondBootstrap.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey }),
    ]));
    expect(secondBootstrap.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey, projectId, topicId, label: "Topic B" }),
    ]));
    const defaultChats = await app.inject({ method: "GET", url: "/api/chats?spaceId=space_default" });
    expect(defaultChats.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey }),
    ]));
    await app.close();
  });

  test("bootstrap imports Gateway sessions without a project into the default space", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { connect: unknown; status: unknown; request: unknown } } }).v2Context;
    context.gateway.connect = vi.fn(async () => undefined);
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.list") {
        return {
          sessions: [
            {
              key: "agent:main:desktop:orphan-before-space",
              label: "Orphan Before Space",
              agentId: "main",
              projectId: null,
              topicId: null,
              createdAt: "2026-05-19T03:00:00.000Z",
              updatedAt: "2026-05-19T03:30:00.000Z",
            },
          ],
        };
      }
      return {};
    });

    const createdSpace = await app.inject({ method: "POST", url: "/api/spaces", payload: { name: "New Project" } });
    const activeSpaceId = createdSpace.json().activeSpaceId;
    await app.inject({ method: "PATCH", url: "/api/spaces/space_default", payload: { name: "Smoke Job", text: "hello", sessionKey: "agent:main:smoke" } });
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });

    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().activeSpaceId).toBe(activeSpaceId);
    expect(bootstrap.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: "agent:main:desktop:orphan-before-space" }),
    ]));
    expect(bootstrap.json().sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: "agent:main:desktop:orphan-before-space" }),
    ]));
    expect(bootstrap.json().spaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "space_default", name: "My Workspace" }),
    ]));
    expect(bootstrap.json().spaces.find((space: { id?: string }) => space.id === "space_default")).not.toHaveProperty("text");

    const defaultChats = await app.inject({ method: "GET", url: "/api/chats?spaceId=space_default" });
    expect(defaultChats.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Orphan Before Space", sessionKey: "agent:main:desktop:orphan-before-space", spaceId: "space_default" }),
    ]));
    const defaultSessions = await app.inject({ method: "GET", url: "/api/sessions?spaceId=space_default" });
    expect(defaultSessions.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: "agent:main:desktop:orphan-before-space", spaceId: "space_default" }),
    ]));
    await app.close();
  });

  test("chat, project, and session list routes default to the active space instead of global", async () => {
    const app = await createApp(testConfig());

    const defaultChat = await app.inject({ method: "POST", url: "/api/chats", payload: { name: "Default Chat", agentId: "main", spaceId: "space_default" } });
    const defaultSessionKey = defaultChat.json().chat.sessionKey as string;
    const defaultProject = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Default Project", spaceId: "space_default" } });

    const createdSpace = await app.inject({ method: "POST", url: "/api/spaces", payload: { name: "Focused Space" } });
    const activeSpaceId = createdSpace.json().activeSpaceId as string;
    const activeChat = await app.inject({ method: "POST", url: "/api/chats", payload: { name: "Active Chat", agentId: "main", spaceId: activeSpaceId } });
    const activeProject = await app.inject({ method: "POST", url: "/api/projects", payload: { name: "Active Project", spaceId: activeSpaceId } });

    const chats = await app.inject({ method: "GET", url: "/api/chats" });
    expect(chats.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: activeChat.json().chat.id, spaceId: activeSpaceId }),
    ]));
    expect(chats.json().chats).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: defaultChat.json().chat.id }),
    ]));

    const sessions = await app.inject({ method: "GET", url: "/api/sessions" });
    expect(sessions.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: activeChat.json().chat.sessionKey, spaceId: activeSpaceId }),
    ]));
    expect(sessions.json().sessions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: defaultSessionKey }),
    ]));

    const projects = await app.inject({ method: "GET", url: "/api/projects" });
    expect(projects.json().projects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: activeProject.json().project.id, spaceId: activeSpaceId }),
    ]));
    expect(projects.json().projects).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: defaultProject.json().project.id }),
    ]));

    const allChats = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    expect(allChats.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: defaultChat.json().chat.id }),
      expect.objectContaining({ id: activeChat.json().chat.id }),
    ]));
    await app.close();
  });

  test("compat chats and sessions survive middleware restart", async () => {
    const databasePath = path.join(os.tmpdir(), `openclaw-v2-compat-restart-${Date.now()}-${Math.random()}.sqlite`);
    const restartConfig = testConfig({ databasePath });
    const first = await createApp(restartConfig);
    const created = await first.inject({ method: "POST", url: "/api/chats", payload: { name: "Persistent Chat", agentId: "main" } });
    expect(created.statusCode).toBe(200);
    const createdBody = created.json();
    await first.close();

    const second = await createApp(restartConfig);
    const chats = await second.inject({ method: "GET", url: "/api/chats" });
    const sessions = await second.inject({ method: "GET", url: "/api/sessions" });
    expect(chats.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: createdBody.chat.id, name: "Persistent Chat", sessionKey: createdBody.chat.sessionKey }),
    ]));
    expect(sessions.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionKey: createdBody.chat.sessionKey }),
    ]));
    await second.close();
  });

  test("chat bootstrap validates sessionKey", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: { code: "INVALID_QUERY" } });
    await app.close();
  });

  test("telegram migration scan includes reset archived transcripts for the same topic", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-archive-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const key = "agent:main:telegram:group:-1001:topic:42";
    const archiveDir = path.join(sessionsDir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const currentFile = path.join(sessionsDir, "current-topic-42.jsonl");
    const archivedFile = path.join(archiveDir, "old-topic-42.jsonl.reset.2026-05-20T00-00-00.000Z");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Topic", is_group_chat: true });
    const line = (id: string, text: string) => JSON.stringify({ type: "message", id, timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\n${text}` } });
    fs.writeFileSync(archivedFile, `${line("a1", "old one")}\n${line("a2", "old two")}\n`);
    fs.writeFileSync(currentFile, `${line("c1", "current one")}\n${line("c2", "current two")}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [key]: { sessionId: "current", sessionFile: currentFile, chatType: "group", subject: "Group" } }));

    const app = await createApp(testConfig());
    const scan = await app.inject({ method: "GET", url: "/api/migration/telegram/scan?agentId=main" });

    expect(scan.statusCode).toBe(200);
    expect(scan.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceSessionKey: key,
        messageCount: 4,
        archivedMessageCount: 2,
        archivedTranscriptFiles: [archivedFile],
      }),
    ]));
    await app.close();
  });

  test("telegram group import names the desktop session from the topic name", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-topic-import-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const key = "agent:main:telegram:group:-1001:topic:42";
    const currentFile = path.join(sessionsDir, "current-topic-42.jsonl");
    const targetFile = path.join(sessionsDir, "imported-topic.jsonl");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Desktop task B", is_group_chat: true });
    const line = JSON.stringify({ type: "message", id: "c1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\nplease implement this very long request that should not become the imported chat name` } });
    fs.writeFileSync(currentFile, `${line}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [key]: { sessionId: "current", sessionFile: currentFile, chatType: "group", subject: "Group" } }));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.create") return { payload: { entry: { sessionFile: targetFile } }, label: params?.label };
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [key], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({ label: "Desktop task B" }), 30_000);
    expect(res.json().imported).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Desktop task B" })]));
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const project = bootstrap.json().projects.find((item: { name?: string; id?: string }) => item.name === "Group");
    expect(project).toBeTruthy();
    const topics = await app.inject({ method: "GET", url: `/api/topics?projectId=${project.id}` });
    expect(topics.json().topics).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Desktop task B" })]));
    expect(bootstrap.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ label: "Desktop task B" })]));
    await app.close();
  });

  test("telegram group import keeps duplicate topic names unique", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-duplicate-topic-import-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const keyA = "agent:main:telegram:group:-1001:topic:42";
    const keyB = "agent:main:telegram:group:-1001:topic:43";
    const fileA = path.join(sessionsDir, "topic-42.jsonl");
    const fileB = path.join(sessionsDir, "topic-43.jsonl");
    const targetA = path.join(sessionsDir, "imported-topic-42.jsonl");
    const targetB = path.join(sessionsDir, "imported-topic-43.jsonl");
    const metaA = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "General", is_group_chat: true });
    const metaB = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "43", group_subject: "Group", topic_name: "General", is_group_chat: true });
    fs.writeFileSync(fileA, `${JSON.stringify({ type: "message", id: "a1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${metaA}\n\`\`\`\n\nfirst topic` } })}\n`);
    fs.writeFileSync(fileB, `${JSON.stringify({ type: "message", id: "b1", timestamp: "2026-05-20T00:01:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${metaB}\n\`\`\`\n\nsecond topic` } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({
      [keyA]: { sessionId: "current-a", sessionFile: fileA, chatType: "group", subject: "Group" },
      [keyB]: { sessionId: "current-b", sessionFile: fileB, chatType: "group", subject: "Group" },
    }));

    const app = await createApp(testConfig());
    const labels: unknown[] = [];
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.create") {
        labels.push(params?.label);
        return { payload: { entry: { sessionFile: labels.length === 1 ? targetA : targetB } }, label: params?.label };
      }
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [keyA, keyB], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    expect(labels).toEqual(["General", "General (2)"]);
    expect(res.json().imported).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "General" }),
      expect.objectContaining({ name: "General (2)" }),
    ]));
    await app.close();
  });

  test("telegram chat bootstrap falls back to session key identity for archived transcripts", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-bootstrap-archive-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    const archiveDir = path.join(sessionsDir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const sessionKey = "agent:main:telegram:group:-1001:topic:42";
    const archivedFile = path.join(archiveDir, "old-topic-42.jsonl.reset.2026-05-20T00-00-00.000Z");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Topic", is_group_chat: true });
    const archivedContent = `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\nold topic message`;
    fs.writeFileSync(archivedFile, `${JSON.stringify({ type: "message", id: "a1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: archivedContent } })}\n`);

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> }, db: Database.Database } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { sessionKey, sessionId: "current-topic-42", messages: [{ role: "user", content: "current topic message", __openclaw: { id: "c1", seq: 1 } }] };
      return {};
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });

    expect(res.statusCode).toBe(200);
    const messages = res.json().messages as Array<{ content?: string }>;
    const text = messages.map((message) => String(message.content || "")).join("\n");
    expect(text).toContain("old topic message");
    expect(text).toContain("current topic message");
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_archive_imports WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 1 });
    await app.close();
  });

  test("chat bootstrap imports same-session archives into separate file-keyed segments", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-archive-same-session-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    const archiveDir = path.join(sessionsDir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const sessionKey = "agent:main:desktop:same-session";
    const currentFile = path.join(sessionsDir, "current.jsonl");
    const archivedFileA = path.join(archiveDir, "same-old.jsonl.reset.2026-05-20T00-00-00.000Z");
    const archivedFileB = path.join(archiveDir, "same-old.jsonl.reset.2026-05-20T01-00-00.000Z");
    const sender = JSON.stringify({ id: "openclaw-control-ui", name: "Jarvis Middleware" });
    const content = (text: string) => `Sender (untrusted metadata):\n\`\`\`json\n${sender}\n\`\`\`\n\n${text}`;
    const line = (id: string, text: string) => JSON.stringify({ type: "message", id, timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: content(text) } });
    fs.writeFileSync(archivedFileA, `${line("a1", "first archive message")}\n`);
    fs.writeFileSync(archivedFileB, `${line("b1", "second archive message")}\n`);
    fs.writeFileSync(currentFile, `${line("c1", "current message")}\n`);

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> }, db: Database.Database } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { sessionKey, sessionId: "current", sessionFile: currentFile, messages: [{ role: "user", content: content("current message"), __openclaw: { id: "c1", seq: 1 } }] };
      return {};
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });

    expect(res.statusCode).toBe(200);
    const text = (res.json().messages as Array<{ content?: string }>).map((message) => String(message.content || "")).join("\n");
    expect(text).toContain("first archive message");
    expect(text).toContain("second archive message");
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_archive_imports WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 2 });
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_chat_segments WHERE session_key = ? AND reset_reason = 'archived_transcript'").get(sessionKey)).toMatchObject({ count: 2 });
    await app.close();
  });

  test("chat bootstrap keeps valid JSONL records when one archive line is malformed", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-malformed-jsonl-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    const archiveDir = path.join(sessionsDir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const sessionKey = "agent:main:desktop:malformed";
    const currentFile = path.join(sessionsDir, "current.jsonl");
    const archivedFile = path.join(archiveDir, "old.jsonl.reset.2026-05-20T00-00-00.000Z");
    const sender = JSON.stringify({ id: "openclaw-control-ui", name: "Jarvis Middleware" });
    const content = (text: string) => `Sender (untrusted metadata):\n\`\`\`json\n${sender}\n\`\`\`\n\n${text}`;
    const line = (id: string, text: string) => JSON.stringify({ type: "message", id, timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: content(text) } });
    fs.writeFileSync(archivedFile, `${line("a1", "valid archived message")}\n{bad-json\n`);
    fs.writeFileSync(currentFile, `${line("c1", "current message")}\n`);

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { sessionKey, sessionId: "current", sessionFile: currentFile, messages: [{ role: "user", content: content("current message"), __openclaw: { id: "c1", seq: 1 } }] };
      return {};
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });

    expect(res.statusCode).toBe(200);
    expect((res.json().messages as Array<{ content?: string }>).map((message) => String(message.content || "")).join("\n")).toContain("valid archived message");
    await app.close();
  });

  test("migration assigns legacy unsegmented messages before archive resequence", () => {
    const dbPath = path.join(os.tmpdir(), `openclaw-legacy-backfill-${Date.now()}-${Math.random()}.sqlite`);
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE v2_messages (session_key TEXT NOT NULL, openclaw_seq INTEGER NOT NULL, message_id TEXT, role TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, PRIMARY KEY (session_key, openclaw_seq));
      INSERT INTO v2_messages(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms)
      VALUES ('s1', 1, 'legacy-1', 'user', '{"role":"user","text":"legacy"}', 1);
    `);

    migrateDatabase(db);

    expect(db.prepare("SELECT count(*) AS count FROM v2_messages WHERE segment_id IS NULL").get()).toMatchObject({ count: 0 });
    expect(db.prepare("SELECT gateway_seq FROM v2_messages WHERE session_key = 's1' AND openclaw_seq = 1").get()).toMatchObject({ gateway_seq: 1 });
    expect(db.prepare("SELECT count(*) AS count FROM v2_chat_segments WHERE session_key = 's1' AND reset_reason = 'legacy_unsegmented'").get()).toMatchObject({ count: 1 });
    db.close();
  });

  test("migration preserves gateway seq invariant when reusing an existing active segment", () => {
    const dbPath = path.join(os.tmpdir(), `openclaw-legacy-backfill-existing-${Date.now()}-${Math.random()}.sqlite`);
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE v2_messages (session_key TEXT NOT NULL, openclaw_seq INTEGER NOT NULL, message_id TEXT, role TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL, segment_id TEXT, session_id TEXT, gateway_seq INTEGER, PRIMARY KEY (session_key, openclaw_seq));
      CREATE TABLE v2_chat_segments (segment_id TEXT PRIMARY KEY, session_key TEXT NOT NULL, session_id TEXT, session_file TEXT, segment_index INTEGER NOT NULL, base_seq INTEGER NOT NULL DEFAULT 0, started_at_ms INTEGER NOT NULL, ended_at_ms INTEGER, reset_reason TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, UNIQUE(session_key, segment_index));
      INSERT INTO v2_chat_segments(segment_id, session_key, segment_index, base_seq, started_at_ms, is_active, created_at_ms, updated_at_ms)
      VALUES ('seg-active', 's1', 1, 10, 1, 1, 1, 1);
      INSERT INTO v2_messages(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms)
      VALUES ('s1', 11, 'legacy-11', 'user', '{"role":"user","text":"legacy"}', 1);
    `);

    migrateDatabase(db);

    expect(db.prepare("SELECT segment_id, gateway_seq FROM v2_messages WHERE session_key = 's1' AND openclaw_seq = 11").get()).toMatchObject({ segment_id: "seg-active", gateway_seq: 1 });
    db.close();
  });

  test("optimistic confirmation does not delete archived global seq on gateway reset", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const archived = context.messages.ensureArchivedSegment({ sessionKey: "s1", sessionId: "old", sessionFile: "/tmp/old.jsonl", startedAtMs: 1 });
    context.messages.upsertMessages(normalizeHistoryMessages("s1", [{ role: "user", text: "old archived", __openclaw: { id: "old-1", seq: 1 } }]), { segmentId: archived.segmentId, sessionId: archived.sessionId, baseSeq: archived.baseSeq });
    const active = context.messages.ensureActiveSegment({ sessionKey: "s1", sessionId: "current" });
    context.messages.insertOptimisticMessage({ sessionKey: "s1", segmentId: active.segmentId, sessionId: active.sessionId, openclawSeq: 2, messageId: "client-1", role: "user", data: { role: "user", text: "new message", __clientOptimistic: true }, updatedAtMs: Date.now() });

    const confirmed = context.messages.confirmOptimisticUser("s1", "client-1", normalizeHistoryMessages("s1", [{ role: "user", text: "new message", __openclaw: { id: "gateway-1", seq: 1 } }])[0]!);

    expect(confirmed?.openclawSeq).toBe(2);
    expect(context.messages.listMessages("s1", { limit: 10 }).map((message) => message.messageId)).toContain("old-1");
    await app.close();
  });

  test("desktop chat bootstrap includes archived reset transcripts", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-desktop-archive-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    const archiveDir = path.join(sessionsDir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const sessionKey = "agent:main:desktop:dash";
    const currentFile = path.join(sessionsDir, "current-dash.jsonl");
    const archivedFile = path.join(archiveDir, "old-dash.jsonl.reset.2026-05-20T00-00-00.000Z");
    const sender = JSON.stringify({ label: "Jarvis Middleware (openclaw-control-ui)", id: "openclaw-control-ui", name: "Jarvis Middleware" });
    const content = (text: string) => `Sender (untrusted metadata):\n\`\`\`json\n${sender}\n\`\`\`\n\n${text}`;
    const line = (id: string, text: string) => JSON.stringify({ type: "message", id, timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: content(text) } });
    fs.writeFileSync(archivedFile, `${line("a1", "old dashboard message")}\n`);
    fs.writeFileSync(currentFile, `${line("c1", "current dashboard message")}\n`);

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> }, db: Database.Database } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { sessionKey, sessionId: "current-dash", sessionFile: currentFile, messages: [{ role: "user", content: content("current dashboard message"), __openclaw: { id: "c1", seq: 1 } }] };
      return {};
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    const secondRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });

    expect(res.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    const messages = secondRes.json().messages as Array<{ content?: string }>;
    const text = messages.map((message) => String(message.content || "")).join("\n");
    expect(text).toContain("old dashboard message");
    expect(text).toContain("current dashboard message");
    expect(messages.filter((message) => String(message.content || "").includes("old dashboard message"))).toHaveLength(1);
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_chat_segments WHERE session_key = ? AND reset_reason = 'archived_transcript'").get(sessionKey)).toMatchObject({ count: 1 });
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_archive_imports WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 1 });
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_messages WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 2 });

    fs.appendFileSync(archivedFile, `${line("a2", "newer archived dashboard message")}\n`);
    const newerMtime = new Date(Date.now() + 10_000);
    fs.utimesSync(archivedFile, newerMtime, newerMtime);
    const thirdRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    expect(thirdRes.statusCode).toBe(200);
    const thirdMessages = thirdRes.json().messages as Array<{ content?: string; __openclaw?: { seq?: number; gatewaySeq?: number | null; segmentId?: string | null } }>;
    const thirdText = thirdMessages.map((message) => String(message.content || "")).join("\n");
    expect(thirdText).toContain("old dashboard message");
    expect(thirdText).toContain("newer archived dashboard message");
    expect(thirdText).toContain("current dashboard message");
    expect(thirdMessages.filter((message) => String(message.content || "").includes("old dashboard message"))).toHaveLength(1);
    expect(thirdMessages.map((message) => message.__openclaw?.seq)).toEqual([1, 2, 3]);
    expect(thirdMessages.map((message) => message.__openclaw?.gatewaySeq)).toEqual([1, 2, 1]);
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_archive_imports WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 1 });
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_messages WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 3 });
    await app.close();
  });

  test("archived tool-call history is imported as messages without resurrecting active tools", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-desktop-archive-tools-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    const archiveDir = path.join(sessionsDir, "archive");
    fs.mkdirSync(archiveDir, { recursive: true });
    const sessionKey = "agent:main:desktop:tools";
    const currentFile = path.join(sessionsDir, "current-tools.jsonl");
    const archivedFile = path.join(archiveDir, "old-tools.jsonl.reset.2026-05-20T00-00-00.000Z");
    const sender = JSON.stringify({ label: "Jarvis Middleware (openclaw-control-ui)", id: "openclaw-control-ui", name: "Jarvis Middleware" });
    const content = (text: string) => `Sender (untrusted metadata):\n\`\`\`json\n${sender}\n\`\`\`\n\n${text}`;
    const archivedAssistant = JSON.stringify({
      type: "message",
      id: "archived-assistant-tool",
      timestamp: "2026-05-20T00:00:00.000Z",
      message: { role: "assistant", content: [{ type: "thinking", text: "older thought" }, { type: "toolCall", id: "old-tool", name: "web_fetch", input: { url: "https://example.com" } }] },
    });
    const archivedToolResult = JSON.stringify({
      type: "message",
      id: "archived-tool-result",
      timestamp: "2026-05-20T00:00:01.000Z",
      message: { role: "toolResult", content: [{ type: "toolResult", toolCallId: "old-tool", result: "older result" }] },
    });
    const currentLine = JSON.stringify({ type: "message", id: "current-user", timestamp: "2026-05-20T00:01:00.000Z", message: { role: "user", content: content("current plain message") } });
    fs.writeFileSync(archivedFile, `${archivedAssistant}\n${archivedToolResult}\n`);
    fs.writeFileSync(currentFile, `${currentLine}\n`);

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> }, db: Database.Database } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { sessionKey, sessionId: "current-tools", sessionFile: currentFile, messages: [{ role: "user", content: content("current plain message"), __openclaw: { id: "current-user", seq: 1 } }] };
      return {};
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    expect(res.statusCode).toBe(200);
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_messages WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 3 });
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_tool_calls WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 0 });
    await app.close();
  });

  test("chat messages supports beforeSeq pagination for older messages", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    context.messages.upsertMessages(normalizeHistoryMessages("s1", Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index + 1}`,
      __openclaw: { id: `m${index + 1}`, seq: index + 1 },
    }))));

    const res = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s1&beforeSeq=10&limit=4" });

    expect(res.statusCode).toBe(200);
    expect(res.json().messages.map((message: { openclawSeq: number }) => message.openclawSeq)).toEqual([6, 7, 8, 9]);
    await app.close();
  });

  test("logs request lifecycle without query strings", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/api/system/info?token=secret&sessionKey=s1" });
    expect(res.statusCode).toBe(200);
    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("request.start");
    expect(output).toContain("request.end");
    expect(output).toContain("/api/system/info");
    expect(output).not.toContain("token=secret");
    await app.close();
  });
});
