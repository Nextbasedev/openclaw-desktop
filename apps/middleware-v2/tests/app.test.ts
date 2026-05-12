import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv, type MiddlewareV2Config } from "../src/config/env.js";

function testConfig(overrides: Partial<MiddlewareV2Config> = {}): MiddlewareV2Config {
  return {
    host: "127.0.0.1",
    port: 8989,
    databasePath: path.join(os.tmpdir(), `openclaw-middleware-v2-app-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:1",
    nodeEnv: "test",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware-v2 app", () => {
  test("defaults to the legacy middleware port", () => {
    expect(loadEnv({ HOME: "/tmp/openclaw-test" } as NodeJS.ProcessEnv).port).toBe(8787);
  });

  test("health returns service metadata and legacy OpenClaw connection alias", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: "openclaw-middleware-v2",
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
    expect(res.json()).toMatchObject({ ok: true, port: 8989 });
    await app.close();
  });

  test("legacy bootstrap compatibility route returns startup payload", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      service: "openclaw-middleware-v2",
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
    expect(res.json()).toMatchObject({ ok: true, service: "openclaw-middleware-v2" });
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
