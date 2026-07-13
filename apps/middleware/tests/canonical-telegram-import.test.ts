// Canonical Telegram import (2026-07-13) direct contract tests.
//
// These tests lock the canonical semantics that a newly imported Telegram
// source keeps its original Gateway sourceSessionKey as the desktop session
// key. No `sessions.create`, no fabricated Gateway transcript, no shadow
// desktop key. Legacy `migrated-*` imports remain supported via the revive
// path (covered elsewhere) and are NOT re-tested here.
//
// Contracts covered:
//   1. Zero `sessions.create` across a fresh import.
//   2. Provenance + compat records use sourceSessionKey as canonical desktop key.
//   3. Gateway history refill fires against the source key (== desktop key).
//   4. Live Gateway `session.message` events project under the same UI key.
//   5. Delete produces a durable local tombstone that survives sync + restart.
//   6. Transcript-only sources (absent from sessions.list AND sessions.json)
//      import as archive-only WITHOUT calling `sessions.create`.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { migrateDatabase } from "../src/db/migrate.js";
import { clearSyncGatewaySessionsCache, clearBootstrapCacheForTests } from "../src/features/compat/routes.js";
import { clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";

type GatewayEvent = { type: "event"; event: string; payload?: Record<string, unknown> };
type GatewayStatus = { connected: boolean; gatewayUrl: string; connectedAtMs: number | null; lastError: string | null; pendingRequests: number; listenerCount: number };
const FAKE_STATUS: GatewayStatus = { connected: true, gatewayUrl: "ws://127.0.0.1:1", connectedAtMs: Date.now(), lastError: null, pendingRequests: 0, listenerCount: 0 };

function testConfig(): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-canonical-telegram-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:1",
    nodeEnv: "test",
  };
}

function seedTelegramSource(home: string, opts: { sourceKey: string; topicName?: string; groupSubject?: string; groupId?: string; topicId?: string; content?: string; withGatewaySessionIndex?: boolean; sessionId?: string }) {
  const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  const sourceFile = path.join(sessionsDir, `${opts.sourceKey.replace(/[^a-zA-Z0-9]+/g, "-")}.jsonl`);
  const meta = JSON.stringify({
    chat_id: `telegram:${opts.groupId ?? "-1001"}`,
    topic_id: opts.topicId ?? "42",
    group_subject: opts.groupSubject ?? "Group",
    topic_name: opts.topicName ?? "Topic 42",
    is_group_chat: true,
  });
  fs.writeFileSync(sourceFile, `${JSON.stringify({
    type: "message",
    id: "m1",
    timestamp: "2026-05-20T00:00:00.000Z",
    message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\n${opts.content ?? "canonical import content"}` },
  })}\n`);
  const sessions: Record<string, unknown> = {};
  if (opts.withGatewaySessionIndex !== false) {
    sessions[opts.sourceKey] = { sessionId: opts.sessionId ?? "topic", sessionFile: sourceFile, chatType: "group", subject: opts.groupSubject ?? "Group" };
  }
  fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify(sessions));
  return { sourceFile, sessionsDir };
}

afterEach(() => {
  vi.restoreAllMocks();
  clearSyncGatewaySessionsCache();
  clearBootstrapCacheForTests();
  clearLocalFirstBootstrapCache();
});

describe("canonical Telegram import", () => {
  test("gateway-backed source: no sessions.create, desktopSessionKey === sourceSessionKey, history uses same key", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-canonical-gateway-backed-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sourceKey = "agent:main:telegram:group:-1001:topic:42";
    seedTelegramSource(home, { sourceKey, topicName: "Canonical topic", content: "first canonical message" });

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    const historyCalls: Array<{ sessionKey: unknown; limit: unknown }> = [];
    vi.spyOn(context.gateway, "status").mockReturnValue(FAKE_STATUS);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method === "sessions.create") throw new Error("canonical import must not call sessions.create");
      if (method === "chat.history") {
        historyCalls.push({ sessionKey: params?.sessionKey, limit: params?.limit });
        return { sessionKey: params?.sessionKey, sessionId: "topic", sessionFile: null, status: "done", messages: [] };
      }
      if (method === "sessions.list") return { sessions: [{ key: sourceKey, label: "Canonical topic", agentId: "main" }] };
      return {};
    });

    const scan = await app.inject({ method: "GET", url: "/api/migration/telegram/scan" });
    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey], scanToken: scan.json().scanToken } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.summary).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    expect(body.imported[0]).toMatchObject({
      sourceSessionKey: sourceKey,
      desktopSessionKey: sourceKey,
      canonicalDesktopSessionKey: true,
      sourceOrigin: "gateway",
    });
    expect(body.imported[0].archiveOnly).not.toBe(true);
    expect((context.gateway.request as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) => call[0] === "sessions.list")).toHaveLength(1);

    // Provenance table entry mirrors the canonical key mapping.
    const durable = context.importProvenance.findByDesktopSessionKey(sourceKey);
    expect(durable).toMatchObject({ desktopSessionKey: sourceKey, sourceSessionKey: sourceKey, lifecycle: "active", platformKind: "telegram" });

    // Zero sessions.create across the whole flow.
    const createCalls = (context.gateway.request as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) => call[0] === "sessions.create");
    expect(createCalls).toHaveLength(0);

    // Prewarm / bootstrap fetches Gateway history keyed by the canonical (source) key.
    await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sourceKey)}` });
    expect(historyCalls.some((call) => call.sessionKey === sourceKey)).toBe(true);
    await app.close();
  });

  test("live session.message under the canonical key projects into the same UI sessionKey", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-canonical-live-projection-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sourceKey = "agent:main:telegram:group:-1001:topic:99";
    seedTelegramSource(home, { sourceKey, topicName: "Live topic", topicId: "99", content: "seed", sessionId: "topic-99" });

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb: (event: GatewayEvent) => void) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical import must not call sessions.create");
      if (method === "chat.history") return { sessionId: "topic-99", sessionFile: null, status: "done", messages: [] };
      if (method === "sessions.list") return { sessions: [{ key: sourceKey, label: "Live topic", agentId: "main" }] };
      return { ok: true };
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported[0]).toMatchObject({ desktopSessionKey: sourceKey, canonicalDesktopSessionKey: true });

    // Subscribe under the canonical key (mirrors the direct-session UX).
    await context.chatLive.ensureSessionSubscribed(sourceKey);
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: sourceKey,
        messageSeq: 1,
        message: {
          role: "assistant",
          text: "canonical live projection",
          __openclaw: { id: "live-msg-1", seq: 1 },
        },
      },
    });

    const patches = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(patches.statusCode).toBe(200);
    expect(patches.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        sessionKey: sourceKey,
        payload: expect.objectContaining({ sessionKey: sourceKey, messageId: "live-msg-1" }),
      }),
    ]));
    await app.close();
  });

  test("local delete produces a durable tombstone that survives sync + restart", async () => {
    const configOnce = testConfig();
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-canonical-tombstone-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sourceKey = "agent:main:telegram:group:-1001:topic:77";
    seedTelegramSource(home, { sourceKey, topicName: "Tombstone topic", topicId: "77", content: "before delete", sessionId: "topic-77" });

    const app = await createApp(configOnce);
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    // Gateway persistently reports the canonical session as live — this is exactly
    // the resurrection risk the tombstone must defend against.
    vi.spyOn(context.gateway, "status").mockReturnValue(FAKE_STATUS);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical import must not call sessions.create");
      if (method === "chat.history") return { sessionId: "topic-77", sessionFile: null, status: "done", messages: [] };
      if (method === "sessions.list") return { sessions: [{ key: sourceKey, label: "Tombstone topic", agentId: "main" }] };
      return {};
    });

    const importRes = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey] } });
    const chatId = importRes.json().imported[0].chatId as string;
    expect(importRes.json().imported[0].desktopSessionKey).toBe(sourceKey);

    const deleted = await app.inject({ method: "DELETE", url: `/api/chats/${chatId}` });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ localOnly: true, sessionKey: sourceKey });

    // Durable tombstone row set.
    const tombstoneRow = context.importProvenance.findByDesktopSessionKey(sourceKey);
    expect(tombstoneRow?.lifecycle).toBe("local_delete_tombstone");

    // Gateway sync must NOT resurrect the imported chat.
    clearSyncGatewaySessionsCache();
    clearBootstrapCacheForTests();
    const afterSync = await app.inject({ method: "GET", url: "/api/chats?all=true" });
    expect(afterSync.json().chats.filter((chat: { sessionKey?: string }) => chat.sessionKey === sourceKey)).toEqual([]);

    await app.close();

    // Restart: fresh app on the same database — tombstone must still block resurrection.
    const app2 = await createApp(configOnce);
    const context2 = (app2 as typeof app2 & { v2Context: AppContext }).v2Context;
    vi.spyOn(context2.gateway, "status").mockReturnValue(FAKE_STATUS);
    vi.spyOn(context2.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "sessions.list") return { sessions: [{ key: sourceKey, label: "Tombstone topic", agentId: "main" }] };
      if (method === "chat.history") return { sessionId: "topic-77", sessionFile: null, status: "done", messages: [] };
      return {};
    });
    clearSyncGatewaySessionsCache();
    clearBootstrapCacheForTests();
    const afterRestart = await app2.inject({ method: "GET", url: "/api/chats?all=true" });
    expect(afterRestart.json().chats.filter((chat: { sessionKey?: string }) => chat.sessionKey === sourceKey)).toEqual([]);
    // Tombstone lifecycle still marked in durable storage.
    const durable2 = context2.importProvenance.findByDesktopSessionKey(sourceKey);
    expect(durable2?.lifecycle).toBe("local_delete_tombstone");
    await app2.close();
  });

  test("transcript-only source imports as archive-only with no sessions.create", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-canonical-transcript-only-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sourceKey = "agent:main:telegram:group:-1001:topic:55";
    seedTelegramSource(home, {
      sourceKey,
      topicName: "Transcript only",
      topicId: "55",
      content: "transcript-only content",
      withGatewaySessionIndex: false, // no sessions.json entry
    });

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "sessions.create") throw new Error("transcript-only imports must not call sessions.create");
      if (method === "sessions.list") return { sessions: [] };
      return {};
    });

    const res = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey] } });
    expect(res.statusCode).toBe(200);
    expect(res.json().imported[0]).toMatchObject({
      sourceSessionKey: sourceKey,
      desktopSessionKey: sourceKey,
      canonicalDesktopSessionKey: true,
      sourceOrigin: "transcript",
      archiveOnly: true,
    });
    const createCalls = (context.gateway.request as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) => call[0] === "sessions.create");
    expect(createCalls).toHaveLength(0);

    // Transcript content is persisted into the local projection under the canonical key.
    const messages = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${encodeURIComponent(sourceKey)}` });
    expect(messages.statusCode).toBe(200);
    const bodies = (messages.json().messages as Array<{ data?: { content?: string } }>).map((m) => m.data?.content ?? "").join("\n");
    expect(bodies).toContain("transcript-only content");

    await app.close();
  });

  test("second import with an active provenance is skipped and remains canonical", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-canonical-idempotent-"));
    vi.spyOn(os, "homedir").mockReturnValue(home);
    const sourceKey = "agent:main:telegram:group:-1001:topic:31";
    seedTelegramSource(home, { sourceKey, topicName: "Idempotent", topicId: "31", content: "one", sessionId: "topic-31" });

    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: AppContext }).v2Context;
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "sessions.create") throw new Error("canonical import must not call sessions.create");
      if (method === "chat.history") return { sessionId: "topic-31", sessionFile: null, status: "done", messages: [] };
      if (method === "sessions.list") return { sessions: [{ key: sourceKey, label: "Idempotent", agentId: "main" }] };
      return {};
    });

    const first = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey] } });
    expect(first.json().summary).toMatchObject({ imported: 1, skipped: 0, failed: 0 });
    const second = await app.inject({ method: "POST", url: "/api/migration/telegram/import", payload: { sourceSessionKeys: [sourceKey] } });
    expect(second.json().summary).toMatchObject({ imported: 0, skipped: 1, failed: 0 });
    const createCalls = (context.gateway.request as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter((call) => call[0] === "sessions.create");
    expect(createCalls).toHaveLength(0);
    // Provenance still active on the canonical key.
    const durable = context.importProvenance.findByDesktopSessionKey(sourceKey);
    expect(durable?.lifecycle).toBe("active");
    await app.close();
  });
});

// Guard: this file exists solely to lock canonical Telegram-import contracts.
// Any regression that reintroduces sessions.create or breaks the source-key
// == desktop-key identity should fail here first. Please do not soften
// assertions to keep unrelated legacy flows green; add legacy coverage in a
// separate test if needed.
void Database;
