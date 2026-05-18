import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import { loadEnv, type MiddlewareConfig } from "../src/config/env.js";
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
          ],
        };
      }
      return {};
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Shared Chat", sessionKey: "agent:main:desktop:shared", spaceId: "space_default" }),
    ]));

    const chats = await app.inject({ method: "GET", url: "/api/chats?spaceId=space_default" });
    expect(chats.json().chats).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Shared Chat", sessionKey: "agent:main:desktop:shared" }),
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
