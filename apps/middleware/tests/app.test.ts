import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp, MIDDLEWARE_BODY_LIMIT_BYTES } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import { loadEnv, type MiddlewareConfig } from "../src/config/env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { clearSyncGatewaySessionsCache, clearBootstrapCacheForTests } from "../src/features/compat/routes.js";
import { clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";

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

function flushBackgroundJobs() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

async function waitFor(condition: () => boolean, timeoutMs = 500) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
  clearBootstrapCacheForTests();
  clearSyncGatewaySessionsCache();
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

  test("middleware update status defaults to the current branch", async () => {
    const originalCwd = process.cwd();
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-status-repo-"));
    const remoteRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-update-status-remote-"));
    const branch = "v6-1-krish";
    try {
      fs.writeFileSync(path.join(repoRoot, "package.json"), "{}\n");
      execFileSync("git", ["init", "-b", branch], { cwd: repoRoot, stdio: "ignore" });
      execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoRoot, stdio: "ignore" });
      execFileSync("git", ["config", "user.name", "Test"], { cwd: repoRoot, stdio: "ignore" });
      execFileSync("git", ["add", "package.json"], { cwd: repoRoot, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", "initial"], { cwd: repoRoot, stdio: "ignore" });
      execFileSync("git", ["init", "--bare"], { cwd: remoteRoot, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", remoteRoot], { cwd: repoRoot, stdio: "ignore" });
      execFileSync("git", ["push", "-u", "origin", branch], { cwd: repoRoot, stdio: "ignore" });

      process.chdir(repoRoot);
      const app = await createApp(testConfig());
      const res = await app.inject({ method: "GET", url: "/api/middleware/update/status" });
      expect(res.statusCode).toBe(200);
      expect(res.json().git).toMatchObject({ currentBranch: branch, targetBranch: branch, upstream: `origin/${branch}` });
      await app.close();
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(repoRoot, { recursive: true, force: true });
      fs.rmSync(remoteRoot, { recursive: true, force: true });
    }
  });

  test("accepts attachment-sized JSON payloads above Fastify default body limit", async () => {
    const app = await createApp(testConfig());
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: {
        sessionKey: "",
        idempotencyKey: "",
        text: "x".repeat(1_200_000),
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: { code: "INVALID_BODY" } });
    await app.close();
  });

  test("returns a clear payload-too-large error above middleware body limit", async () => {
    const app = await createApp(testConfig());
    const body = JSON.stringify({ text: "x".repeat(MIDDLEWARE_BODY_LIMIT_BYTES + 1) });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      headers: { "content-type": "application/json" },
      payload: body,
    });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({
      ok: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "Payload too large. Attachments must be 25 MB or smaller.",
      },
    });
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

  test("new chat creation only persists the chat and session compat collections", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { db: Database.Database } }).v2Context;
    context.db.prepare("UPDATE v2_compat_state SET data_json = ?, updated_at_ms = ? WHERE key = ?")
      .run(JSON.stringify([{ id: "run_1", payload: "large unrelated state" }]), 123, "cronRuns");

    const res = await app.inject({ method: "POST", url: "/api/chats", payload: { name: "Fast create", agentId: "main" } });

    expect(res.statusCode).toBe(200);
    const cronRuns = context.db.prepare("SELECT updated_at_ms FROM v2_compat_state WHERE key = ?").get("cronRuns");
    const chats = context.db.prepare("SELECT updated_at_ms FROM v2_compat_state WHERE key = ?").get("chats");
    const sessions = context.db.prepare("SELECT updated_at_ms FROM v2_compat_state WHERE key = ?").get("sessions");
    expect(cronRuns).toMatchObject({ updated_at_ms: 123 });
    expect(chats).toMatchObject({ updated_at_ms: expect.any(Number) });
    expect(sessions).toMatchObject({ updated_at_ms: expect.any(Number) });
    await app.close();
  });

  test("pairing claim returns forwarded https origin behind a proxy", async () => {
    const app = await createApp(testConfig({ pairingCode: "PAIR1234", middlewareToken: "token-1" }));

    const res = await app.inject({
      method: "POST",
      url: "/pairing/claim",
      headers: {
        host: "127.0.0.1:8787",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "oc-example.tail.ts.net",
      },
      payload: { code: "PAIR1234" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true,
      url: "https://oc-example.tail.ts.net",
      token: "token-1",
      mode: "remote",
    });
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

  test("deleting an imported Telegram desktop chat only removes local import records", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-import-delete-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:42";
    const sourceFile = path.join(sessionsDir, "topic-42.jsonl");
    const targetFile = path.join(sessionsDir, "imported-topic-42.jsonl");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Topic 42", is_group_chat: true });
    fs.writeFileSync(sourceFile, `${JSON.stringify({ type: "message", id: "m1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\ndelete imported safely` } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [sourceSessionKey]: { sessionId: "topic", sessionFile: sourceFile, chatType: "group", subject: "Group" } }));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.create") return { payload: { entry: { sessionFile: targetFile } }, label: params?.label };
      return { ok: true };
    });

    const imported = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceSessionKey] } });
    const chatId = imported.json().imported[0].chatId as string;
    const desktopSessionKey = imported.json().imported[0].desktopSessionKey as string;

    const deleteRes = await app.inject({ method: "DELETE", url: `/api/chats/${chatId}` });

    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json()).toMatchObject({ ok: true, chatId, sessionKey: desktopSessionKey, localOnly: true });
    expect(context.gateway.request.mock.calls.some(([method]) => method === "sessions.delete" || method === "sessions.abort")).toBe(false);
    const chats = await app.inject({ method: "GET", url: "/api/chats" });
    expect(chats.json().chats).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: chatId })]));
    await app.close();
  });

  test("re-import revives a tombstoned Telegram desktop identity without Gateway-sync duplicates", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-reimport-tombstone-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:42";
    const sourceFile = path.join(sessionsDir, "topic-42.jsonl");
    const targetFile = path.join(sessionsDir, "imported-topic-42.jsonl");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Topic 42", is_group_chat: true });
    fs.writeFileSync(sourceFile, `${JSON.stringify({ type: "message", id: "m1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\nrestore this import` } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [sourceSessionKey]: { sessionId: "topic", sessionFile: sourceFile, chatType: "group", subject: "Group" } }));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    let gatewayCanonicalKey = "";
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical telegram import must not call sessions.create");
      if (method === "sessions.list") return { sessions: gatewayCanonicalKey ? [{ key: gatewayCanonicalKey, label: "Topic 42", agentId: "main" }] : [] };
      if (method === "chat.history") return { sessionId: "topic", sessionFile: sourceFile, status: "done", messages: [] };
      return {};
    });

    const first = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceSessionKey] } });
    const chatId = first.json().imported[0].chatId as string;
    const firstDesktopSessionKey = first.json().imported[0].desktopSessionKey as string;
    // Canonical: desktopSessionKey == sourceSessionKey.
    expect(firstDesktopSessionKey).toBe(sourceSessionKey);
    gatewayCanonicalKey = firstDesktopSessionKey;

    const deleted = await app.inject({ method: "DELETE", url: `/api/chats/${chatId}` });
    expect(deleted.json()).toMatchObject({ localOnly: true, sessionKey: firstDesktopSessionKey });

    context.gateway.request.mockClear();
    clearSyncGatewaySessionsCache();
    clearBootstrapCacheForTests();
    const afterDeleteSync = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.list", expect.objectContaining({ limit: 500 }), 10_000);
    expect(afterDeleteSync.json().chats).not.toEqual(expect.arrayContaining([expect.objectContaining({ sessionKey: firstDesktopSessionKey })]));

    const reimported = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceSessionKey] } });
    expect(reimported.json().summary).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect(reimported.json().imported[0]).toMatchObject({ desktopSessionKey: firstDesktopSessionKey });
    expect(context.gateway.request.mock.calls.filter(([method]) => method === "sessions.create")).toHaveLength(0);

    context.gateway.request.mockClear();
    clearSyncGatewaySessionsCache();
    clearBootstrapCacheForTests();
    const afterReimportSync = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.list", expect.objectContaining({ limit: 500 }), 10_000);
    const sessionsAfterReimportSync = await app.inject({ method: "GET", url: "/api/sessions?all=true" });
    const importedChats = afterReimportSync.json().chats.filter((chat: { sessionKey?: string }) => chat.sessionKey === firstDesktopSessionKey);
    const importedSessions = sessionsAfterReimportSync.json().sessions.filter((session: { sessionKey?: string }) => session.sessionKey === firstDesktopSessionKey);
    expect(importedChats).toHaveLength(1);
    expect(importedSessions).toHaveLength(1);
    expect(importedChats[0]).toMatchObject({ importedFrom: { kind: "telegram", sourceSessionKey } });
    await app.close();
  });

  test("bulk chat delete tombstones every imported identity before Gateway sync", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-bulk-tombstone-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sourceKeys = ["agent:main:telegram:group:-1001:topic:42", "agent:main:telegram:group:-1001:topic:43"];
    const meta = (topicId: string) => JSON.stringify({ chat_id: "telegram:-1001", topic_id: topicId, group_subject: "Group", topic_name: `Topic ${topicId}`, is_group_chat: true });
    const sourceIndex: Record<string, { sessionId: string; sessionFile: string; chatType: string; subject: string }> = {};
    for (const [index, sourceKey] of sourceKeys.entries()) {
      const topicId = String(42 + index);
      const sourceFile = path.join(sessionsDir, `topic-${topicId}.jsonl`);
      fs.writeFileSync(sourceFile, `${JSON.stringify({ type: "message", id: `m${topicId}`, timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta(topicId)}\n\`\`\`\n\nbulk tombstone ${topicId}` } })}\n`);
      sourceIndex[sourceKey] = { sessionId: `topic-${topicId}`, sessionFile: sourceFile, chatType: "group", subject: "Group" };
    }
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify(sourceIndex));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { db: Database.Database; gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    // Canonical: desktop keys == source keys. No sessions.create.
    const desktopSessionKeys: string[] = [...sourceKeys];
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical telegram import must not call sessions.create");
      if (method === "sessions.list") return { sessions: desktopSessionKeys.map((key, index) => ({ key, label: `Topic ${42 + index}`, agentId: "main" })) };
      if (method === "chat.history") return { sessionId: null, sessionFile: null, status: "done", messages: [] };
      return {};
    });

    const imported = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: sourceKeys } });
    expect(imported.json().summary).toMatchObject({ imported: 2 });
    // Canonical: every imported desktop key is the original source key.
    for (const entry of imported.json().imported as Array<{ desktopSessionKey: string; sourceSessionKey: string }>) {
      expect(entry.desktopSessionKey).toBe(entry.sourceSessionKey);
    }
    const deleted = await app.inject({ method: "DELETE", url: "/api/chats" });
    expect(deleted.json()).toMatchObject({ ok: true, deleted: 2, sessionsCleaned: 2 });
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_sessions WHERE session_key IN (?, ?)").get(...desktopSessionKeys)).toMatchObject({ count: 0 });

    const tombstones = context.db.prepare("SELECT data_json FROM v2_compat_state WHERE key IN ('chats', 'sessions')").all() as Array<{ data_json: string }>;
    const tombstonedKeys = tombstones.flatMap((row) => JSON.parse(row.data_json) as Array<{ sessionKey?: string; key?: string; deleted?: boolean; archived?: boolean; importedFrom?: unknown }>)
      .filter((record) => record.importedFrom && record.deleted && record.archived)
      .map((record) => record.sessionKey ?? record.key);
    expect(tombstonedKeys).toEqual(expect.arrayContaining(desktopSessionKeys));

    context.gateway.request.mockClear();
    clearSyncGatewaySessionsCache();
    clearBootstrapCacheForTests();
    const afterSync = await app.inject({ method: "GET", url: "/api/bootstrap" });
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.list", expect.objectContaining({ limit: 500 }), 10_000);
    expect(afterSync.json().chats.filter((chat: { sessionKey?: string }) => desktopSessionKeys.includes(String(chat.sessionKey)))).toEqual([]);
    expect(afterSync.json().sessions.filter((session: { sessionKey?: string }) => desktopSessionKeys.includes(String(session.sessionKey)))).toEqual([]);
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

  test("groq file naming settings save, report connected, generate, remove, and fallback", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-groq-file-naming-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Build API Client" } }] }),
    } as Response);

    const app = await createApp(testConfig());

    const initial = await app.inject({ method: "POST", url: "/api/commands/middleware_file_naming_groq_get", payload: {} });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().settings).toMatchObject({ connected: false, enabled: false });

    const saved = await app.inject({ method: "POST", url: "/api/commands/middleware_file_naming_groq_set", payload: { input: { apiKey: "gsk_test_key" } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toMatchObject({ connected: true, enabled: true, provider: "groq", keyPreview: "••••_key" });
    const storedSecret = (app as typeof app & { v2Context: { db: Database.Database } }).v2Context.db.prepare("SELECT value_json FROM v2_secret_settings WHERE key = ?").get("file_naming.groq") as { value_json?: string } | undefined;
    expect(storedSecret?.value_json).toContain("gsk_test_key");
    expect(fs.readFileSync(path.join(home, ".openclaw", "openclaw.json"), "utf8")).not.toContain("gsk_test_key");

    const named = await app.inject({ method: "POST", url: "/api/commands/middleware_autonaming_quick", payload: { input: { prompt: "please build a TypeScript API client for Stripe invoices" } } });
    expect(named.statusCode).toBe(200);
    expect(named.json()).toMatchObject({ name: "Build API Client", title: "Build API Client" });
    expect(fetchSpy).toHaveBeenCalledWith("https://api.groq.com/openai/v1/chat/completions", expect.objectContaining({ method: "POST" }));

    const removed = await app.inject({ method: "POST", url: "/api/commands/middleware_file_naming_groq_remove", payload: {} });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().settings).toMatchObject({ connected: false, enabled: false, keyPreview: null });
    const removedSecret = (app as typeof app & { v2Context: { db: Database.Database } }).v2Context.db.prepare("SELECT value_json FROM v2_secret_settings WHERE key = ?").get("file_naming.groq");
    expect(removedSecret).toBeUndefined();

    fetchSpy.mockClear();
    const fallback = await app.inject({ method: "POST", url: "/api/commands/middleware_autonaming_quick", payload: { input: { prompt: "please build a TypeScript API client for Stripe invoices" } } });
    expect(fallback.statusCode).toBe(200);
    expect(fallback.json().name).toBe("please build a TypeScript API client for Stripe invoices");
    expect(fetchSpy).not.toHaveBeenCalled();

    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
  });

  test("new sessions use groq-generated gateway labels when connected", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-groq-session-label-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "Stripe Invoice Client" } }] }),
    } as Response);

    const app = await createApp(testConfig());
    await app.inject({ method: "POST", url: "/api/commands/middleware_file_naming_groq_set", payload: { input: { apiKey: "gsk_test_key" } } });
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async () => ({}));

    const res = await app.inject({ method: "POST", url: "/api/commands/middleware_sessions_create", payload: { input: { sessionKey: "agent:main:desktop:test-groq-label", label: "please build a TypeScript API client for Stripe invoices", agentId: "main" } } });

    expect(res.statusCode).toBe(200);
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({ label: "Stripe Invoice Client · oq-label" }));

    await app.close();
    fs.rmSync(home, { recursive: true, force: true });
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

    // Clear the sync cache so the second bootstrap re-evaluates compat state
    clearSyncGatewaySessionsCache();
    clearBootstrapCacheForTests();
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
    await app.inject({
      method: "POST",
      url: "/api/commands/middleware_spaces_update",
      payload: {
        spaceId: "space_default",
        name: "Renamed Workspace",
        iconEmoji: { emoji: "🦊", label: "fox", color: "from-orange-500 to-amber-700" },
      },
    });
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
      expect.objectContaining({
        id: "space_default",
        name: "Renamed Workspace",
        iconEmoji: { emoji: "🦊", label: "fox", color: "from-orange-500 to-amber-700" },
      }),
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

  test("chat bootstrap and messages strip inbound metadata from serialized user text", async () => {
    const sessionKey = "agent:main:desktop:metadata-cleanup";
    const conversation = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Desktop", sender: "Dixit" });
    const sender = JSON.stringify({ label: "Dixit", id: "1245183865", username: "dix105" });
    const metadataPrefix = `Conversation info (untrusted metadata):\n\`\`\`json\n${conversation}\n\`\`\`\n\nSender (untrusted metadata):\n\`\`\`json\n${sender}\n\`\`\`\n\n`;
    const rawContent = `${metadataPrefix}[Fri 2026-05-22 05:10 UTC] Give me introduction speech\n\n[Bootstrap truncation warning]\nSome workspace bootstrap files were truncated before injection.`;
    const rawText = `${metadataPrefix}[Wed 2026-05-20 14:22 PDT] Clean top-level text`;
    const rawBlockText = `${metadataPrefix}[Thu 2026-05-21 09:15 GMT] Clean content block`;

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> }, db: Database.Database } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "chat.history") return { sessionKey, sessionId: "session-metadata-cleanup", messages: [
        { role: "user", content: rawContent, __openclaw: { id: "u1", seq: 1 } },
        { role: "user", text: rawText, __openclaw: { id: "u2", seq: 2 } },
        { role: "user", content: [{ type: "text", text: rawBlockText }], __openclaw: { id: "u3", seq: 3 } },
      ] };
      return {};
    });

    const bootstrap = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    expect(bootstrap.statusCode).toBe(200);
    const bootstrapMessages = bootstrap.json().messages as Array<{ content?: string | Array<{ text?: string }>; text?: string }>;
    expect(bootstrapMessages[0].content).toBe("Give me introduction speech");
    expect(bootstrapMessages[1].text).toBe("Clean top-level text");
    expect(Array.isArray(bootstrapMessages[2].content) ? bootstrapMessages[2].content[0].text : null).toBe("Clean content block");

    const messages = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&limit=10` });
    expect(messages.statusCode).toBe(200);
    const messageRows = messages.json().messages as Array<{ data: { content?: string | Array<{ text?: string }>; text?: string } }>;
    expect(messageRows[0].data.content).toBe("Give me introduction speech");
    expect(messageRows[1].data.text).toBe("Clean top-level text");
    expect(Array.isArray(messageRows[2].data.content) ? messageRows[2].data.content[0].text : null).toBe("Clean content block");

    const rawStored = context.db.prepare("SELECT data_json FROM v2_messages WHERE session_key = ? AND message_id = ?").get(sessionKey, "u1") as { data_json: string };
    expect(rawStored.data_json).toContain("Conversation info (untrusted metadata)");
    expect(rawStored.data_json).toContain("[Bootstrap truncation warning]");
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

  test("telegram migration scan merges canonical Telegram sessions from Gateway history", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-gateway-scan-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const diskKey = "agent:main:telegram:group:-1001:topic:42";
    const gatewayOnlyKey = "agent:main:telegram:group:-1001:topic:43";
    const ignoredSubagentKey = "agent:main:subagent:abc";
    const diskFile = path.join(sessionsDir, "disk-topic-42.jsonl");
    const gatewayFile = path.join(sessionsDir, "gateway-topic-43.jsonl");
    const transcriptOnlyFile = path.join(sessionsDir, "transcript-only-topic-45.jsonl");
    const meta = (topicId: string, topicName: string) => JSON.stringify({ chat_id: "telegram:-1001", topic_id: topicId, group_subject: "Group", topic_name: topicName, is_group_chat: true });
    const line = (topicId: string, topicName: string, text: string) => JSON.stringify({ type: "message", id: `m-${topicId}`, timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta(topicId, topicName)}\n\`\`\`\n\n${text}` } });
    fs.writeFileSync(diskFile, `${line("42", "Disk topic", "disk message")}\n`);
    fs.writeFileSync(gatewayFile, `${line("43", "Gateway topic", "gateway message")}\n`);
    fs.writeFileSync(transcriptOnlyFile, `${line("45", "Transcript-only topic", "transcript-only message")}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({
      [diskKey]: { sessionId: "disk", sessionFile: diskFile, chatType: "group", subject: "Group" },
    }));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.list") {
        return { sessions: [
          { key: gatewayOnlyKey, sessionId: "gateway", transcriptPath: gatewayFile, displayName: "Group", updatedAt: "2026-05-20T00:01:00.000Z" },
          { key: ignoredSubagentKey, channel: "telegram", displayName: "Telegram subagent", transcriptPath: gatewayFile, deliveryContext: { channel: "telegram", to: "telegram:-1001", threadId: "44" } },
          { key: "agent:main:discord:channel:1", displayName: "Discord" },
        ] };
      }
      return {};
    });

    const scan = await app.inject({ method: "GET", url: "/api/migration/telegram/scan?agentId=main" });

    expect(scan.statusCode).toBe(200);
    expect(context.gateway.request).toHaveBeenCalledWith("sessions.list", expect.objectContaining({ limit: 1000 }), 10_000);
    expect(scan.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceSessionKey: diskKey, sourceSessionFile: diskFile, proposedName: "Disk topic" }),
      expect.objectContaining({ sourceSessionKey: gatewayOnlyKey, sourceSessionFile: gatewayFile, proposedName: "Gateway topic" }),
      expect.objectContaining({ sourceSessionKey: "agent:main:telegram:group:-1001:topic:45", sourceSessionFile: transcriptOnlyFile, proposedName: "Transcript-only topic" }),
    ]));
    expect(scan.json().sessions).not.toEqual(expect.arrayContaining([expect.objectContaining({ sourceSessionKey: ignoredSubagentKey })]));
    expect(scan.json().summary).toMatchObject({ total: 3, groups: 1, topics: 3 });
    await app.close();
  });

  test("telegram group import names the desktop session from the topic name", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-topic-import-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const key = "agent:main:telegram:group:-1001:topic:42";
    const currentFile = path.join(sessionsDir, "current-topic-42.jsonl");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Desktop task B", is_group_chat: true });
    const line = JSON.stringify({ type: "message", id: "c1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\nplease implement this very long request that should not become the imported chat name` } });
    fs.writeFileSync(currentFile, `${line}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [key]: { sessionId: "current", sessionFile: currentFile, chatType: "group", subject: "Group" } }));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical telegram import must not call sessions.create");
      if (method === "sessions.list") return { sessions: [{ key, sessionId: "current", sessionFile: currentFile, displayName: "Gateway-known topic" }] };
      if (method === "chat.history") return { sessionKey: key, sessionId: "current", sessionFile: currentFile, status: "done", messages: [] };
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [key], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    expect(context.gateway.request.mock.calls.filter(([method]) => method === "sessions.create")).toHaveLength(0);
    expect(res.json().imported).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Desktop task B", desktopSessionKey: key, canonicalDesktopSessionKey: true })]));
    await flushBackgroundJobs();
    context.gateway.request.mockClear();
    const chatBootstrap = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(key)}` });
    expect(chatBootstrap.statusCode).toBe(200);
    // Canonical: chat.history is called against the original sourceSessionKey (== desktopSessionKey).
    // dedupedChatHistory may omit the optional timeout arg, so match on method + payload only.
    const historyCalls = (context.gateway.request as ReturnType<typeof vi.fn>).mock.calls
      .filter(([method, params]) => method === "chat.history" && (params as { sessionKey?: string })?.sessionKey === key);
    expect(historyCalls.length).toBeGreaterThanOrEqual(1);
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const telegramSpace = bootstrap.json().spaces.find((item: { id?: string; name?: string; importedFrom?: { kind?: string; scope?: string } }) => item.name === "Telegram" && item.importedFrom?.kind === "telegram" && item.importedFrom?.scope === "session-migration");
    expect(telegramSpace).toBeTruthy();
    const projects = await app.inject({ method: "GET", url: `/api/projects?spaceId=${telegramSpace.id}` });
    expect(projects.json().projects).toEqual([]);
    const chats = await app.inject({ method: "GET", url: `/api/chats?spaceId=${telegramSpace.id}` });
    expect(chats.json().chats).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Desktop task B", sessionKey: key, spaceId: telegramSpace.id, projectId: null, topicId: null })]));
    expect(bootstrap.json().sessions).not.toEqual(expect.arrayContaining([expect.objectContaining({ label: "Desktop task B" })]));
    await app.close();
  });

  test("telegram import handles transcript-discovered sessions without gateway parent linkage", async () => {
    // Canonical (2026-07-13): transcript-only Telegram sources have no Gateway
    // session (absent from sessions.list). The importer must NOT call
    // sessions.create, must NOT fabricate a Gateway transcript, and must keep
    // the original sourceSessionKey as the desktop session key. Transcript
    // messages land only in the local projection (archive-only).
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-transcript-only-import-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sourceKey = "agent:main:telegram:group:-1001:topic:45";
    const sourceFile = path.join(sessionsDir, "transcript-only-topic-45.jsonl");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "45", group_subject: "Group", topic_name: "Transcript-only", is_group_chat: true });
    fs.writeFileSync(sourceFile, `${JSON.stringify({ type: "message", id: "t1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\ntranscript-only import` } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({}));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical transcript-only telegram import must not call sessions.create");
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    expect(context.gateway.request.mock.calls.filter(([method]) => method === "sessions.create")).toHaveLength(0);
    expect(res.json().summary).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    // Transcript-only imports are marked archive-only and use the original key.
    expect(res.json().imported[0]).toMatchObject({ desktopSessionKey: sourceKey, sourceOrigin: "transcript", archiveOnly: true, canonicalDesktopSessionKey: true });
    const importedSessionKey = res.json().imported[0].desktopSessionKey;
    expect(importedSessionKey).toBe(sourceKey);
    const messages = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${encodeURIComponent(importedSessionKey)}` });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().messages.map((message: { data?: { content?: string } }) => message.data?.content).join("\n")).toContain("transcript-only import");
    await app.close();
  });

  test("telegram re-import repairs old group-project imports into flat Telegram space", async () => {
    const config = testConfig();

    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-repair-project-import-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sourceKey = "agent:main:telegram:group:-1001:topic:42";
    const sourceFile = path.join(sessionsDir, "topic-42.jsonl");
    const targetFile = path.join(sessionsDir, "imported-topic-42.jsonl");
    const meta = JSON.stringify({ chat_id: "telegram:-1001", topic_id: "42", group_subject: "Group", topic_name: "Topic 42", is_group_chat: true });
    fs.writeFileSync(sourceFile, `${JSON.stringify({ type: "message", id: "r1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\nrepair old import` } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [sourceKey]: { sessionId: "topic", sessionFile: sourceFile, chatType: "group", subject: "Group" } }));

    const timestamp = Date.now();
    const db = new Database(config.databasePath);
    migrateDatabase(db);
    const save = db.prepare("INSERT INTO v2_compat_state(key, data_json, updated_at_ms) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data_json = excluded.data_json, updated_at_ms = excluded.updated_at_ms");
    save.run("spaces", JSON.stringify([{ id: "space_default", name: "My Workspace", archived: false }]), timestamp);
    save.run("activeSpaceId", JSON.stringify("space_default"), timestamp);
    save.run("projects", JSON.stringify([{ id: "proj_old", name: "Krish & MK", spaceId: "space_default", importedFrom: { kind: "telegram", groupId: "-1001" } }]), timestamp);
    save.run("topics", JSON.stringify([{ id: "topic_old", projectId: "proj_old", name: "Topic 42", importedFrom: { kind: "telegram", sourceSessionKey: sourceKey } }]), timestamp);
    save.run("sessions", JSON.stringify([
      { id: "session_old", key: "agent:main:desktop:migrated-telegram-old", sessionKey: "agent:main:desktop:migrated-telegram-old", label: "Topic 42", spaceId: "space_default", projectId: "proj_old", topicId: "topic_old", importedFrom: { kind: "telegram", sourceSessionKey: sourceKey } },
      { id: "session_duplicate", key: "agent:main:desktop:migrated-telegram-duplicate", sessionKey: "agent:main:desktop:migrated-telegram-duplicate", label: "Topic 42", spaceId: "space_default", projectId: "proj_old", topicId: "topic_old", importedFrom: { kind: "telegram", sourceSessionKey: sourceKey } },
    ]), timestamp);
    save.run("chats", JSON.stringify([
      { id: "chat_old", name: "Topic 42", sessionKey: "agent:main:desktop:migrated-telegram-old", spaceId: "space_default", projectId: "proj_old", topicId: "topic_old", importedFrom: { kind: "telegram", sourceSessionKey: sourceKey } },
      { id: "chat_duplicate", name: "Topic 42", sessionKey: "agent:main:desktop:migrated-telegram-duplicate", spaceId: "space_default", projectId: "proj_old", topicId: "topic_old", importedFrom: { kind: "telegram", sourceSessionKey: sourceKey } },
      { id: "chat_gateway_mirror", name: "Topic 42", sessionKey: "agent:main:desktop:migrated-telegram-old", spaceId: "space_default", projectId: null, topicId: null },
    ]), timestamp);
    db.close();

    const app = await createApp(config);
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "chat.history") return { sessionKey: params?.sessionKey, sessionId: "topic", sessionFile: sourceFile, messages: [{ role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\nrepair old import`, __openclaw: { id: "r1", seq: 1 } }] };
      if (method === "sessions.create") return { payload: { entry: { sessionFile: targetFile } }, label: params?.label };
      return {};
    });

    const pageMessages = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${encodeURIComponent("agent:main:desktop:migrated-telegram-old")}&beforeSeq=9007199254740991&limit=160` });
    expect(pageMessages.statusCode).toBe(200);
    expect(pageMessages.json().messages.map((message: { data?: { content?: string } }) => message.data?.content).join("\n")).toContain("repair old import");
    expect(context.gateway.request.mock.calls.some(([method]) => method === "sessions.create")).toBe(false);
    const lazyHistory = await app.inject({ method: "POST", url: "/api/commands/middleware_chat_history", payload: { input: { sessionKey: "agent:main:desktop:migrated-telegram-old" } } });
    expect(lazyHistory.statusCode).toBe(200);
    expect(lazyHistory.json().messages.map((message: { content?: string }) => message.content).join("\n")).toContain("repair old import");

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    expect(context.gateway.request).not.toHaveBeenCalledWith("sessions.create", expect.anything(), expect.anything());
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const telegramSpace = bootstrap.json().spaces.find((item: { id?: string; name?: string; importedFrom?: { kind?: string; scope?: string } }) => item.name === "Telegram" && item.importedFrom?.kind === "telegram" && item.importedFrom?.scope === "session-migration");
    expect(telegramSpace).toBeTruthy();
    const projects = await app.inject({ method: "GET", url: `/api/projects?spaceId=${telegramSpace.id}` });
    expect(projects.json().projects).toEqual([]);
    expect(bootstrap.json().projects).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "proj_old" })]));
    expect(bootstrap.json().sessions).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "session_old" })]));
    const sessions = await app.inject({ method: "GET", url: `/api/sessions?spaceId=${telegramSpace.id}` });
    expect(sessions.json().sessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ importedFrom: { kind: "telegram", sourceSessionKey: sourceKey }, projectId: null, topicId: null }),
    ]));
    expect(sessions.json().sessions.every((session: { projectId?: unknown; topicId?: unknown }) => session.projectId == null && session.topicId == null)).toBe(true);
    expect(sessions.json().sessions).toHaveLength(1);
    const chats = await app.inject({ method: "GET", url: `/api/chats?spaceId=${telegramSpace.id}` });
    expect(chats.json().chats).toEqual(expect.arrayContaining([expect.objectContaining({ projectId: null, topicId: null })]));
    expect(chats.json().chats.every((chat: { projectId?: unknown; topicId?: unknown }) => chat.projectId == null && chat.topicId == null)).toBe(true);
    expect(chats.json().chats).toHaveLength(1);
    await app.close();
  });

  test("telegram direct import creates and uses the dedicated Telegram space", async () => {
    // Canonical (2026-07-13): Gateway-backed source keeps its sourceSessionKey
    // as the desktop session key, no sessions.create. Local projection is
    // driven by transcript + prewarm; second import is idempotent-skipped.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-telegram-direct-project-import-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const key = "agent:main:telegram:direct:5229873315";
    const currentFile = path.join(sessionsDir, "telegram-direct.jsonl");
    fs.writeFileSync(currentFile, `${JSON.stringify({ type: "message", id: "d1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: "please keep this in telegram project" } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [key]: { sessionId: "direct", sessionFile: currentFile, chatType: "direct", displayName: "Telegram direct" } }));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical telegram import must not call sessions.create");
      if (method === "chat.history") return { sessionId: "direct", sessionFile: currentFile, status: "done", messages: [] };
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [key], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    const importedSessionKey = res.json().imported[0].desktopSessionKey;
    expect(importedSessionKey).toBe(key); // canonical: desktopSessionKey === sourceSessionKey
    const messages = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${encodeURIComponent(importedSessionKey)}` });
    expect(messages.statusCode).toBe(200);
    // Gateway-backed source: chat.messages goes to Gateway; the transcript
    // hydration fallback covers the local view for this test's stub.
    const secondRes = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [key], skipAlreadyImported: false } });
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.json().summary).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    // Canonical: zero sessions.create across both imports.
    expect(context.gateway.request.mock.calls.filter(([method]) => method === "sessions.create")).toHaveLength(0);
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const telegramSpace = bootstrap.json().spaces.find((item: { id?: string; name?: string; importedFrom?: { kind?: string; scope?: string } }) => item.name === "Telegram" && item.importedFrom?.kind === "telegram" && item.importedFrom?.scope === "session-migration");
    expect(telegramSpace).toBeTruthy();
    const projects = await app.inject({ method: "GET", url: `/api/projects?spaceId=${telegramSpace.id}` });
    expect(projects.json().projects).toEqual([]);
    const chats = await app.inject({ method: "GET", url: `/api/chats?spaceId=${telegramSpace.id}` });
    expect(chats.json().chats).toEqual(expect.arrayContaining([expect.objectContaining({ name: "please keep this in telegram project", spaceId: telegramSpace.id, projectId: null, topicId: null })]));
    expect(chats.json().chats).toHaveLength(1);
    const sessions = await app.inject({ method: "GET", url: `/api/sessions?spaceId=${telegramSpace.id}` });
    expect(sessions.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ spaceId: telegramSpace.id, projectId: null, topicId: null })]));
    expect(sessions.json().sessions).toHaveLength(1);
    await app.close();
  });

  test("discord import creates and uses the dedicated Discord space", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-discord-project-import-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const key = "agent:main:discord:channel:777:thread:888";
    const currentFile = path.join(sessionsDir, "discord-thread.jsonl");
    const targetFile = path.join(sessionsDir, "imported-discord-thread.jsonl");
    fs.writeFileSync(currentFile, `${JSON.stringify({ type: "message", id: "c1", timestamp: "2026-05-20T00:00:00.000Z", message: { role: "user", content: "discord thread import request" } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [key]: { sessionId: "thread", sessionFile: currentFile, channelName: "fresh desktop", displayName: "Discord channel" } }));

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.create") return { payload: { entry: { sessionFile: targetFile } }, label: params?.label };
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/discord/import", payload: { sourceSessionKeys: [key], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    const importedSessionKey = res.json().imported[0].desktopSessionKey;
    const messages = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${encodeURIComponent(importedSessionKey)}` });
    expect(messages.statusCode).toBe(200);
    expect(messages.json().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ data: expect.objectContaining({ content: "discord thread import request" }) }),
    ]));
    const secondRes = await app.inject({ method: "POST", url: "/api/migration/discord/import", payload: { sourceSessionKeys: [key], skipAlreadyImported: false } });
    expect(secondRes.statusCode).toBe(200);
    expect(secondRes.json().summary).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    expect(context.gateway.request.mock.calls.filter(([method]) => method === "sessions.create")).toHaveLength(0);
    const bootstrap = await app.inject({ method: "GET", url: "/api/bootstrap" });
    const discordSpace = bootstrap.json().spaces.find((item: { id?: string; name?: string; importedFrom?: { kind?: string; scope?: string } }) => item.name === "Discord" && item.importedFrom?.kind === "discord" && item.importedFrom?.scope === "session-migration");
    expect(discordSpace).toBeTruthy();
    const projects = await app.inject({ method: "GET", url: `/api/projects?spaceId=${discordSpace.id}` });
    expect(projects.json().projects).toEqual([]);
    const chats = await app.inject({ method: "GET", url: `/api/chats?spaceId=${discordSpace.id}` });
    expect(chats.json().chats).toEqual(expect.arrayContaining([expect.objectContaining({ name: "fresh desktop", spaceId: discordSpace.id, projectId: null, topicId: null })]));
    expect(chats.json().chats).toHaveLength(1);
    const sessions = await app.inject({ method: "GET", url: `/api/sessions?spaceId=${discordSpace.id}` });
    expect(sessions.json().sessions).toEqual(expect.arrayContaining([expect.objectContaining({ spaceId: discordSpace.id, projectId: null, topicId: null })]));
    expect(sessions.json().sessions).toHaveLength(1);
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
    const context = (app as typeof app & { v2Context: { gateway: { request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical telegram import must not call sessions.create");
      if (method === "chat.history") return { sessionId: null, sessionFile: null, status: "done", messages: [] };
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [keyA, keyB], skipAlreadyImported: false } });

    expect(res.statusCode).toBe(200);
    // Canonical: zero sessions.create; unique names still enforced via label logic on the response payload.
    expect(context.gateway.request.mock.calls.filter(([method]) => method === "sessions.create")).toHaveLength(0);
    expect(res.json().imported).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "General" }),
      expect.objectContaining({ name: "General (2)" }),
    ]));
    // Both imports keep their original source keys as canonical desktop keys.
    const importedKeys = res.json().imported.map((entry: { desktopSessionKey: string }) => entry.desktopSessionKey).sort();
    expect(importedKeys).toEqual([keyA, keyB].sort());
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
    await flushBackgroundJobs();
    const secondRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });

    expect(res.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    const messages = secondRes.json().messages as Array<{ content?: string }>;
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
    await flushBackgroundJobs();
    const secondRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });

    expect(res.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    const text = (secondRes.json().messages as Array<{ content?: string }>).map((message) => String(message.content || "")).join("\n");
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
    await flushBackgroundJobs();
    const secondRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });

    expect(res.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    expect((secondRes.json().messages as Array<{ content?: string }>).map((message) => String(message.content || "")).join("\n")).toContain("valid archived message");
    await app.close();
  });

  test("chat bootstrap prunes stale active projection rows after canonical history sync", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:stale-local";
    vi.spyOn(context.gateway, "status").mockReturnValue({
      connected: true,
      gatewayUrl: "ws://127.0.0.1:1",
      connectedAtMs: Date.now(),
      lastError: null,
      pendingRequests: 0,
      listenerCount: 0,
    });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey,
          sessionId: "session-1",
          messages: [
            { role: "user", text: "one", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", text: "two", __openclaw: { id: "a1", seq: 2 } },
          ],
        };
      }
      return { ok: true };
    });

    context.messages.upsertSession({ sessionKey, sessionId: "session-1", data: { sessionKey, sessionId: "session-1", status: "done" } });
    const segment = context.messages.ensureActiveSegment({ sessionKey, sessionId: "session-1" });
    context.messages.upsertMessages(normalizeHistoryMessages(sessionKey, [
      { role: "user", text: "one", __openclaw: { id: "u1", seq: 1 } },
      { role: "assistant", text: "two", __openclaw: { id: "a1", seq: 2 } },
      { role: "user", text: "stale duplicate", __openclaw: { id: "stale-u", seq: 3 } },
      { role: "assistant", text: "stale answer", __openclaw: { id: "stale-a", seq: 4 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    const first = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    expect(first.statusCode).toBe(200);
    expect(first.json().messages).toHaveLength(2);

    await waitFor(() => context.messages.countMessages(sessionKey) === 2);
    expect(context.messages.listMessages(sessionKey).map((message) => message.messageId)).toEqual(["u1", "a1"]);

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.bootstrap",
        payload: expect.objectContaining({ pruned: 2 }),
      }),
    ]));
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
    await flushBackgroundJobs();
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_projection_events WHERE session_key = ? AND event_type = 'chat.bootstrap' AND json_extract(payload_json, '$.backgroundArchiveImport') = 1").get(sessionKey)).toMatchObject({ count: 1 });
    clearLocalFirstBootstrapCache();
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
    clearLocalFirstBootstrapCache();
    const thirdRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    await flushBackgroundJobs();
    clearLocalFirstBootstrapCache();
    const fourthRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    expect(thirdRes.statusCode).toBe(200);
    expect(fourthRes.statusCode).toBe(200);
    const thirdMessages = fourthRes.json().messages as Array<{ content?: string; __openclaw?: { seq?: number; gatewaySeq?: number | null; segmentId?: string | null } }>;
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
    await flushBackgroundJobs();
    const secondRes = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    expect(res.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(200);
    expect(context.db.prepare("SELECT count(*) AS count FROM v2_messages WHERE session_key = ?").get(sessionKey)).toMatchObject({ count: 3 });
    // Archived tool calls are now PROJECTED (Problem 2 fix) so historical cards
    // render — but as a terminal, run-detached row, NOT resurrected as running.
    const toolRows = context.db.prepare("SELECT tool_call_id, run_id, status FROM v2_tool_calls WHERE session_key = ?").all(sessionKey) as Array<{ tool_call_id: string; run_id: string | null; status: string }>;
    expect(toolRows.length).toBe(1);
    expect(toolRows[0]).toMatchObject({ tool_call_id: "old-tool", run_id: null, status: "success" });
    expect(toolRows.every((row) => row.status !== "running")).toBe(true);
    await app.close();
  });

  test("chat messages ignores stale beforeSeq pagination and returns full history", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    context.messages.upsertMessages(normalizeHistoryMessages("s1", Array.from({ length: 12 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index + 1}`,
      __openclaw: { id: `m${index + 1}`, seq: index + 1 },
    }))));

    const res = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s1&beforeSeq=10&limit=4" });

    expect(res.statusCode).toBe(200);
    expect(res.json().messages.map((message: { openclawSeq: number }) => message.openclawSeq)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
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

/**
 * Imported-session 160-message window contract.
 *
 * Per docs/plans/2026-07-09-imported-session-160-window-plan.md:
 * bootstrap returns only the latest 160; hasOlder when more exists; scroll-up
 * pages contiguously to seq=1; imported sessions skip gateway refill; continue
 * uses the same sessionKey. Imported and normal sessions share the same window
 * path (zero behavioral special-casing in UI).
 *
 * Seq field shapes:
 * - Bootstrap messages: serializeProjectedMessage → `__openclaw.seq` (no top-level openclawSeq)
 * - /api/chat/messages rows: top-level `openclawSeq`
 * - Bootstrap meta: `oldestLoadedSeq`, `hasOlder`, `historyCoverage`
 */
describe("imported session full-history contract", () => {
  const TOTAL = 500;
  const INITIAL_WINDOW = 160;

  type BootstrapMsg = { __openclaw?: { seq?: number }; openclawSeq?: number };
  type PageMsg = { openclawSeq: number };

  function bootstrapSeq(message: BootstrapMsg): number {
    const nested = message.__openclaw?.seq;
    if (typeof nested === "number") return nested;
    if (typeof message.openclawSeq === "number") return message.openclawSeq;
    return Number.NaN;
  }

  function buildHistoryMessages(total: number) {
    return Array.from({ length: total }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: "text", text: `message ${index + 1}` }],
      __openclaw: { id: `imp-${index + 1}`, seq: index + 1 },
      timestamp: 1_781_000_000_000 + index + 1,
    }));
  }

  function seedProjection(context: AppContext, sessionKey: string, total: number) {
    const messages = buildHistoryMessages(total);
    context.messages.upsertSession({
      sessionKey,
      sessionId: "imported-sid",
      data: { sessionKey, sessionId: "imported-sid", status: "done", label: "Imported" },
    });
    const segment = context.messages.ensureActiveSegment({
      sessionKey,
      sessionId: "imported-sid",
      sessionFile: "/tmp/imported.jsonl",
    });
    context.messages.upsertMessages(
      normalizeHistoryMessages(sessionKey, messages),
      { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq },
    );
    return context.messages.listAllMessages(sessionKey).length;
  }

  function markImported(context: AppContext, sessionKey: string, sourceSessionKey: string) {
    context.compat = {
      touchChatActivity: context.compat?.touchChatActivity ?? (() => undefined),
      hydrateImportedChatHistory: context.compat?.hydrateImportedChatHistory,
      importedPlatformSessionLink: (key: string) =>
        key === sessionKey ? { kind: "telegram", sourceSessionKey, label: "Imported" } : null,
    };
  }

  function mockGatewayHistory(context: AppContext, sessionKey: string, total: number, empty = false) {
    context.gateway.request = vi.fn(async (method: string) => {
      if (method === "chat.history") {
        // Return the full transcript when non-empty so bootstrap prune does not
        // drop older rows that tests later page with beforeSeq. Bootstrap still
        // window-reads via listMessages({ limit, latest: true }).
        if (empty) {
          return { sessionKey, sessionId: "imported-sid", sessionFile: null, status: "done", messages: [] };
        }
        return {
          sessionKey,
          sessionId: "imported-sid",
          sessionFile: null,
          status: "done",
          messages: buildHistoryMessages(total),
        };
      }
      if (method === "chat.send") {
        return { runId: "run-imported-continue", status: "started" };
      }
      if (method === "sessions.create") {
        return { payload: { entry: { sessionFile: "/tmp/imported.jsonl", sessionId: "imported-sid" } } };
      }
      return {};
    }) as unknown as AppContext["gateway"]["request"];
  }

  test("imported session bootstrap loads full local projection (empty gateway + local projection)", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:migrated-telegram-contract";
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:42";

    // Real imported path: gateway has no history; projection already holds full transcript.
    mockGatewayHistory(context, sessionKey, TOTAL, true);
    markImported(context, sessionKey, sourceSessionKey);
    const projectedBefore = seedProjection(context, sessionKey, TOTAL);
    expect(projectedBefore).toBe(TOTAL);

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages.length).toBe(TOTAL);
    expect(body.hasOlder).toBe(false);
    expect(body.historyCoverage).toBe("full");
    expect(body.oldestLoadedSeq).toBe(1);

    const seqs = (body.messages as BootstrapMsg[]).map(bootstrapSeq);
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(TOTAL);

    // Bootstrap prune must not wipe imported projection when gateway history is empty.
    expect(context.messages.listAllMessages(sessionKey).length).toBe(TOTAL);
    await app.close();
  });

  test("normal session bootstrap returns full Gateway history", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:normal-contract";
    mockGatewayHistory(context, sessionKey, TOTAL, false);

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages.length).toBe(TOTAL);
    expect(body.hasOlder).toBe(false);
    expect(body.oldestLoadedSeq).toBe(1);
    const seqs = (body.messages as BootstrapMsg[]).map(bootstrapSeq);
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(TOTAL);
    await app.close();
  });

  test("imported session stale older-page request still returns full history", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:migrated-telegram-scroll";
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:42";
    mockGatewayHistory(context, sessionKey, TOTAL, true);
    markImported(context, sessionKey, sourceSessionKey);
    seedProjection(context, sessionKey, TOTAL);

    const bootstrap = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(bootstrap.statusCode).toBe(200);
    let oldest = bootstrap.json().oldestLoadedSeq as number;
    expect(oldest).toBe(1);

    let pages = 0;
    let reachedStart = oldest === 1;
    while (oldest > 1 && pages < 100) {
      const page = await app.inject({
        method: "GET",
        url: `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&beforeSeq=${oldest}&limit=100`,
      });
      expect(page.statusCode).toBe(200);
      const pageSeqs = (page.json().messages as PageMsg[]).map((message) => message.openclawSeq);
      expect(pageSeqs.length).toBeGreaterThan(0);
      // No gap: the new page's max seq must be exactly oldest-1 (contiguous).
      expect(Math.max(...pageSeqs)).toBe(oldest - 1);
      oldest = Math.min(...pageSeqs);
      pages += 1;
      if (oldest === 1) {
        reachedStart = true;
        // Last page is shorter than a full page once we hit the true start.
        expect(pageSeqs.length).toBeLessThanOrEqual(100);
        break;
      }
    }
    expect(reachedStart).toBe(true);
    expect(oldest).toBe(1);
    await app.close();
  });

  test("normal session stale older-page request still returns full history", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:normal-scroll";
    // Seed full local history so older pages come from SQLite (not gateway refill).
    mockGatewayHistory(context, sessionKey, TOTAL, false);
    seedProjection(context, sessionKey, TOTAL);

    const bootstrap = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    let oldest = bootstrap.json().oldestLoadedSeq as number;

    let pages = 0;
    let reachedStart = oldest === 1;
    while (oldest > 1 && pages < 100) {
      const page = await app.inject({
        method: "GET",
        url: `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&beforeSeq=${oldest}&limit=100`,
      });
      const pageSeqs = (page.json().messages as PageMsg[]).map((message) => message.openclawSeq);
      expect(Math.max(...pageSeqs)).toBe(oldest - 1);
      oldest = Math.min(...pageSeqs);
      pages += 1;
      if (oldest === 1) {
        reachedStart = true;
        break;
      }
    }
    expect(reachedStart).toBe(true);
    await app.close();
  });

  test("canonical imported session refills an older-page miss with one direct-source Gateway history call", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:telegram:group:-1001:topic:42";
    const sourceSessionKey = sessionKey;
    mockGatewayHistory(context, sessionKey, TOTAL, true);
    markImported(context, sessionKey, sourceSessionKey);
    // Intentionally leave local projection EMPTY so the refill path would fire
    // for a normal session. Hydrate no-ops without a real source file.

    const page = await app.inject({
      method: "GET",
      url: `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&beforeSeq=400&limit=100`,
    });
    expect(page.statusCode).toBe(200);
    const historyCalls = (context.gateway.request as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([method]) => method === "chat.history",
    );
    // Canonical imports keep the original source key as their desktop key. A
    // local older-page miss must therefore call Gateway once with that same
    // key, rather than skipping the refill or issuing a redundant duplicate.
    expect(historyCalls).toHaveLength(1);
    expect(historyCalls[0]?.[1]).toEqual(expect.objectContaining({ sessionKey }));
    await app.close();
  });

  test("imported session continue uses the same sessionKey (full gateway context preserved)", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:migrated-telegram-continue";
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:42";
    mockGatewayHistory(context, sessionKey, TOTAL, true);
    markImported(context, sessionKey, sourceSessionKey);
    seedProjection(context, sessionKey, TOTAL);

    const bootstrap = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(bootstrap.statusCode).toBe(200);
    expect((bootstrap.json().messages as unknown[]).length).toBe(TOTAL);

    await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: {
        sessionKey,
        message: "continue the imported chat",
        clientMessageId: "client-continue",
        idempotencyKey: "idem-continue",
      },
    });
    expect(context.gateway.request).toHaveBeenCalledWith(
      "chat.send",
      expect.objectContaining({ sessionKey }),
      expect.any(Number),
    );
    await app.close();
  });

  test("after continue-send, partial gateway history must NOT prune the imported projection (root race)", async () => {
    // ROOT CAUSE regression:
    // 1) Import seeds full local projection (seq 1..TOTAL)
    // 2) User continues chat → gateway now has transcript
    // 3) Next bootstrap fetches chat.history(limit=160) → returns TAIL only
    // 4) Old code pruned SQLite to that tail → loadOlder/render broke
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:migrated-telegram-after-send-prune";
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:99";
    markImported(context, sessionKey, sourceSessionKey);
    seedProjection(context, sessionKey, TOTAL);
    expect(context.messages.listAllMessages(sessionKey).length).toBe(TOTAL);

    // Simulate post-send gateway: only the latest INITIAL_WINDOW messages exist
    // in the history RPC response (windowed sample — not full transcript).
    context.gateway.request = vi.fn(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        const limit = typeof payload?.limit === "number" ? payload.limit : INITIAL_WINDOW;
        const all = buildHistoryMessages(TOTAL);
        return {
          sessionKey,
          sessionId: "imported-sid",
          sessionFile: null,
          status: "done",
          messages: all.slice(-Math.min(limit, TOTAL)),
        };
      }
      return {};
    }) as unknown as AppContext["gateway"]["request"];

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages.length).toBe(TOTAL);
    expect(body.hasOlder).toBe(false);

    // Critical: full imported projection must still be in SQLite.
    expect(context.messages.listAllMessages(sessionKey).length).toBe(TOTAL);

    // Older pages must still resolve contiguously from the preserved projection.
    const oldest = body.oldestLoadedSeq as number;
    expect(oldest).toBe(1);
    const page = await app.inject({
      method: "GET",
      url: `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&beforeSeq=${oldest}&limit=100`,
    });
    expect(page.statusCode).toBe(200);
    const pageSeqs = (page.json().messages as PageMsg[]).map((m) => m.openclawSeq);
    expect(pageSeqs.length).toBe(TOTAL);
    expect(Math.min(...pageSeqs)).toBe(1);
    expect(Math.max(...pageSeqs)).toBe(TOTAL);
    await app.close();
  });

  test("Phase 3: imported full-history read returns one contiguous full set", async () => {
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:migrated-telegram-phase3-seq";
    markImported(context, sessionKey, "agent:main:telegram:group:-1001:topic:phase3");
    mockGatewayHistory(context, sessionKey, TOTAL, true);
    seedProjection(context, sessionKey, TOTAL);

    const bootstrap = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(bootstrap.statusCode).toBe(200);
    const body = bootstrap.json();
    expect(body.messages.length).toBe(TOTAL);
    expect(body.hasOlder).toBe(false);
    expect(body.historyCoverage).toBe("full");
    expect(body.oldestLoadedSeq).toBe(1);

    const page = await app.inject({
      method: "GET",
      url: `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&beforeSeq=341&limit=100`,
    });
    expect(page.statusCode).toBe(200);
    const seqs = (page.json().messages as PageMsg[]).map((m) => m.openclawSeq);
    expect(seqs.length).toBe(TOTAL);
    expect(Math.min(...seqs)).toBe(1);
    expect(Math.max(...seqs)).toBe(TOTAL);
    const sorted = [...seqs].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]).toBe(sorted[i - 1]! + 1);
    }
    await app.close();
  });

  test("Phase 3: short session (<160) reports full coverage and hasOlder=false (parity)", async () => {
    const SHORT = 47;
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:short-parity";
    mockGatewayHistory(context, sessionKey, SHORT, false);

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messages.length).toBe(SHORT);
    expect(body.hasOlder).toBe(false);
    expect(body.historyCoverage).toBe("full");
    expect(body.oldestLoadedSeq).toBe(1);
    await app.close();
  });

  test("Phase 4: normal short session STILL prunes stale local rows (no regression on prune)", async () => {
    // Safety: Phase 1 skip-prune for windowed/imported must not disable prune
    // for short complete gateway histories (stale duplicate cleanup).
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:phase4-still-prunes";
    vi.spyOn(context.gateway, "status").mockReturnValue({
      connected: true,
      gatewayUrl: "ws://127.0.0.1:1",
      connectedAtMs: Date.now(),
      lastError: null,
      pendingRequests: 0,
      listenerCount: 0,
    });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey,
          sessionId: "session-p4",
          messages: [
            { role: "user", text: "one", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", text: "two", __openclaw: { id: "a1", seq: 2 } },
          ],
        };
      }
      return { ok: true };
    });

    context.messages.upsertSession({ sessionKey, sessionId: "session-p4", data: { sessionKey, sessionId: "session-p4", status: "done" } });
    const segment = context.messages.ensureActiveSegment({ sessionKey, sessionId: "session-p4" });
    context.messages.upsertMessages(normalizeHistoryMessages(sessionKey, [
      { role: "user", text: "one", __openclaw: { id: "u1", seq: 1 } },
      { role: "assistant", text: "two", __openclaw: { id: "a1", seq: 2 } },
      { role: "user", text: "stale", __openclaw: { id: "stale-u", seq: 3 } },
      { role: "assistant", text: "stale-a", __openclaw: { id: "stale-a", seq: 4 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toHaveLength(2);
    await waitFor(() => context.messages.countMessages(sessionKey) === 2);
    expect(context.messages.listMessages(sessionKey).map((m) => m.messageId)).toEqual(["u1", "a1"]);
    await app.close();
  });

  test("Phase 4: imported continue path — bootstrap full + stale page request still full projection", async () => {
    // End-to-end data path for the user bug: open → "send" (gateway has tail) →
    // bootstrap again → older page still works (projection not wiped).
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const sessionKey = "agent:main:desktop:phase4-continue-e2e";
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:p4";
    markImported(context, sessionKey, sourceSessionKey);
    seedProjection(context, sessionKey, TOTAL);

    // Open (empty gateway)
    mockGatewayHistory(context, sessionKey, TOTAL, true);
    const open = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(open.statusCode).toBe(200);
    expect(open.json().messages.length).toBe(TOTAL);
    expect(context.messages.listAllMessages(sessionKey).length).toBe(TOTAL);

    // After continue: gateway returns windowed tail only
    context.gateway.request = vi.fn(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        const limit = typeof payload?.limit === "number" ? payload.limit : INITIAL_WINDOW;
        return {
          sessionKey,
          sessionId: "imported-sid",
          status: "done",
          messages: buildHistoryMessages(TOTAL).slice(-Math.min(limit, TOTAL)),
        };
      }
      if (method === "chat.send") return { runId: "run-p4", status: "started" };
      return {};
    }) as unknown as AppContext["gateway"]["request"];

    await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: {
        sessionKey,
        message: "continue after import",
        clientMessageId: "p4-client",
        idempotencyKey: "p4-idem",
      },
    });

    const after = await app.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().messages.length).toBeGreaterThanOrEqual(TOTAL); // full import plus optimistic/live rows
    // Projection must still hold the full import (the actual wipe bug).
    expect(context.messages.listAllMessages(sessionKey).length).toBeGreaterThanOrEqual(TOTAL);

    const oldest = after.json().oldestLoadedSeq as number;
    expect(typeof oldest).toBe("number");
    if (oldest > 1) {
      const page = await app.inject({
        method: "GET",
        url: `/api/chat/messages?sessionKey=${encodeURIComponent(sessionKey)}&beforeSeq=${oldest}&limit=100`,
      });
      expect(page.statusCode).toBe(200);
      expect((page.json().messages as PageMsg[]).length).toBeGreaterThan(0);
      expect(Math.max(...(page.json().messages as PageMsg[]).map((m) => m.openclawSeq))).toBe(oldest - 1);
    }
    await app.close();
  });

  test("Phase 3: imported vs normal open full-history shapes are identical for same projection size", async () => {
    const appImported = await createApp(testConfig());
    const ctxImported = (appImported as typeof appImported & { v2Context: AppContext }).v2Context;
    const importedKey = "agent:main:desktop:parity-imported";
    markImported(ctxImported, importedKey, "agent:main:telegram:group:-1:topic:parity");
    mockGatewayHistory(ctxImported, importedKey, TOTAL, true);
    seedProjection(ctxImported, importedKey, TOTAL);

    const appNormal = await createApp(testConfig());
    const ctxNormal = (appNormal as typeof appNormal & { v2Context: AppContext }).v2Context;
    const normalKey = "agent:main:desktop:parity-normal";
    mockGatewayHistory(ctxNormal, normalKey, TOTAL, false);
    seedProjection(ctxNormal, normalKey, TOTAL);

    const importedBoot = await appImported.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(importedKey)}&limit=${INITIAL_WINDOW}`,
    });
    const normalBoot = await appNormal.inject({
      method: "GET",
      url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(normalKey)}&limit=${INITIAL_WINDOW}`,
    });
    expect(importedBoot.statusCode).toBe(200);
    expect(normalBoot.statusCode).toBe(200);
    const i = importedBoot.json();
    const n = normalBoot.json();
    expect(i.messages.length).toBe(n.messages.length);
    expect(i.messages.length).toBe(TOTAL);
    expect(i.hasOlder).toBe(n.hasOlder);
    expect(i.historyCoverage).toBe(n.historyCoverage);
    expect(i.oldestLoadedSeq).toBe(n.oldestLoadedSeq);
    await appImported.close();
    await appNormal.close();
  });
});
