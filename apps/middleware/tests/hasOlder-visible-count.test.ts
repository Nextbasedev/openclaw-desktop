import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { allowLocalFirstSqliteForTests, clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";

function config(name: string): MiddlewareConfig {
  return { host: "127.0.0.1", port: 8787, databasePath: path.join(os.tmpdir(), `oc-visible-${name}-${Date.now()}-${Math.random()}.sqlite`), openclawGatewayUrl: "ws://127.0.0.1:1", nodeEnv: "test" };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>) {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function insertRaw(context: AppContext, input: { sessionKey: string; seq: number; role: string; id: string; text: string; extra?: Record<string, unknown>; clientMessageId?: string | null; runId?: string | null; logicalTurnKey?: string | null; textFingerprint?: string | null }) {
  context.db.prepare(`
    INSERT INTO v2_messages(session_key, openclaw_seq, message_id, role, data_json, updated_at_ms, client_message_id, run_id, logical_turn_key, text_fingerprint)
    VALUES (@sessionKey, @seq, @id, @role, @dataJson, @updatedAtMs, @clientMessageId, @runId, @logicalTurnKey, @textFingerprint)
  `).run({
    sessionKey: input.sessionKey,
    seq: input.seq,
    id: input.id,
    role: input.role,
    dataJson: JSON.stringify({ role: input.role, text: input.text, ...(input.extra ?? {}) }),
    updatedAtMs: 100 + input.seq,
    clientMessageId: input.clientMessageId ?? null,
    runId: input.runId ?? null,
    logicalTurnKey: input.logicalTurnKey ?? null,
    textFingerprint: input.textFingerprint ?? null,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

describe("authoritative visible count and hasOlder", () => {
  test("excludes duplicate optimistic echoes and hidden rows; hasOlder is false when oldest visible row is loaded", async () => {
    allowLocalFirstSqliteForTests();
    const app = await createApp(config("full"));
    try {
      const context = contextOf(app);
      context.messages.upsertSession({ sessionKey: "s1", sessionId: "sid", data: { sessionKey: "s1" } });
      const fp = "user-text:same";
      insertRaw(context, { sessionKey: "s1", seq: 1, role: "user", id: "client-1", text: "same", extra: { __clientOptimistic: true }, clientMessageId: "client-1", logicalTurnKey: "client:client-1", textFingerprint: fp });
      insertRaw(context, { sessionKey: "s1", seq: 2, role: "user", id: "gateway-1", text: "same", textFingerprint: fp });
      insertRaw(context, { sessionKey: "s1", seq: 3, role: "hidden", id: "hidden-1", text: "nope" });
      insertRaw(context, { sessionKey: "s1", seq: 4, role: "assistant", id: "assistant-1", text: "visible" });
      context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "chat.message.upsert", payload: { sessionKey: "s1" } });

      const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1&limit=10" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ knownVisibleTotal: 2, oldestVisibleSeq: 1, oldestLoadedSeq: 1, hasOlder: false });
      expect(res.json().messages.map((message: { messageId?: string }) => message.messageId)).toEqual(["client-1", "assistant-1"]);
    } finally {
      await app.close();
    }
  });

  test("excludes tool and transient rows from visible totals", async () => {
    allowLocalFirstSqliteForTests();
    const app = await createApp(config("tool-rows"));
    try {
      const context = contextOf(app);
      context.messages.upsertSession({ sessionKey: "s1", sessionId: "sid", data: { sessionKey: "s1" } });
      insertRaw(context, { sessionKey: "s1", seq: 1, role: "tool", id: "tool-1", text: "not transcript" });
      insertRaw(context, { sessionKey: "s1", seq: 2, role: "toolResult", id: "tool-result-1", text: "not transcript" });
      insertRaw(context, { sessionKey: "s1", seq: 3, role: "user", id: "u1", text: "hello" });
      insertRaw(context, { sessionKey: "s1", seq: 4, role: "assistant", id: "a1", text: "hi" });
      insertRaw(context, { sessionKey: "s1", seq: 5, role: "transient", id: "thinking", text: "thinking" });
      context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "chat.message.upsert", payload: { sessionKey: "s1" } });

      const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1&limit=10" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ knownVisibleTotal: 2, oldestVisibleSeq: 3, oldestLoadedSeq: 3, hasOlder: false });
      expect(res.json().messages.map((message: { messageId?: string }) => message.messageId)).toEqual(["u1", "a1"]);
    } finally {
      await app.close();
    }
  });

  test("hasOlder is true when the returned window starts after the oldest visible row", async () => {
    allowLocalFirstSqliteForTests();
    const app = await createApp(config("windowed"));
    try {
      const context = contextOf(app);
      context.messages.upsertSession({ sessionKey: "s1", sessionId: "sid", data: { sessionKey: "s1" } });
      insertRaw(context, { sessionKey: "s1", seq: 1, role: "user", id: "u1", text: "one" });
      insertRaw(context, { sessionKey: "s1", seq: 2, role: "assistant", id: "a1", text: "two" });
      insertRaw(context, { sessionKey: "s1", seq: 3, role: "assistant", id: "a2", text: "three" });
      context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "chat.message.upsert", payload: { sessionKey: "s1" } });

      const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1&limit=2" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ knownVisibleTotal: 3, oldestVisibleSeq: 1, oldestLoadedSeq: 2, hasOlder: true });
    } finally {
      await app.close();
    }
  });
});
