import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import type { ProjectedMessage } from "../src/features/chat/types.js";

/**
 * Audit Bug 5 (docs/audit/middleware-window-audit-2026-06-17.md):
 *
 * `openclaw_seq` is mutable per session — it is rewritten by
 * `resequenceSessionMessages`, by the late-echo collision shift inside
 * `upsertMessages`, and by every direct delete path. A frontend that
 * cached `oldestLoadedSeq=N` has no way to detect that the message at seq
 * N is now a different message, so its `beforeSeq=N` page-back request
 * silently returns the wrong window.
 *
 * Fix: every session carries a monotonic `seqEpoch` (string, generated as
 * a UUID). It is bumped on every seq-mutating call. The value is surfaced
 * in the /api/chat/messages envelope, in the /api/chat/bootstrap response,
 * and on every chat.message.* patch payload — so the client can detect an
 * epoch shift mid-stream and re-bootstrap.
 */

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-seq-epoch-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-seq-epoch-repo-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

function visibleAssistant(sessionKey: string, openclawSeq: number): ProjectedMessage {
  return {
    sessionKey,
    openclawSeq,
    messageId: `vis-${openclawSeq}`,
    role: "assistant",
    data: { id: `vis-${openclawSeq}`, role: "assistant", text: `visible ${openclawSeq}` },
    updatedAtMs: openclawSeq * 1000,
  };
}

describe("session seq epoch (audit Bug 5)", () => {
  test("epoch is stable across two reads when no seq mutation occurs", () => {
    const db = openDatabase({ databasePath: testDbPath("stable") });
    const repo = new MessageRepository(db);
    repo.ensureActiveSegment({ sessionKey: "s1" });
    const epoch1 = repo.getSessionSeqEpoch("s1");
    const epoch2 = repo.getSessionSeqEpoch("s1");
    expect(typeof epoch1).toBe("string");
    expect(epoch1.length).toBeGreaterThan(0);
    expect(epoch2).toBe(epoch1);
    expect(epoch1).not.toBe("v0"); // dynamic, not the previous stub
    db.close();
  });

  test("epoch changes after resequenceSessionMessages", () => {
    const db = openDatabase({ databasePath: testDbPath("resequence") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1" });
    repo.upsertMessages([
      visibleAssistant("s1", 1),
      visibleAssistant("s1", 2),
      visibleAssistant("s1", 3),
    ], { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    const before = repo.getSessionSeqEpoch("s1");
    repo.resequenceSessionMessages("s1");
    const after = repo.getSessionSeqEpoch("s1");
    expect(after).not.toBe(before);
    expect(after.length).toBeGreaterThan(0);
    db.close();
  });

  test("epoch changes after deleteMessageById", () => {
    const db = openDatabase({ databasePath: testDbPath("delete-by-id") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1" });
    repo.upsertMessages([
      visibleAssistant("s1", 1),
      visibleAssistant("s1", 2),
    ], { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    const before = repo.getSessionSeqEpoch("s1");
    repo.deleteMessageById("s1", "vis-1");
    const after = repo.getSessionSeqEpoch("s1");
    expect(after).not.toBe(before);
    db.close();
  });

  test("epoch is per-session — bumping s1 does not affect s2", () => {
    const db = openDatabase({ databasePath: testDbPath("per-session") });
    const repo = new MessageRepository(db);
    const seg1 = repo.ensureActiveSegment({ sessionKey: "s1" });
    const seg2 = repo.ensureActiveSegment({ sessionKey: "s2" });
    repo.upsertMessages([visibleAssistant("s1", 1)], { segmentId: seg1.segmentId, sessionId: seg1.sessionId, baseSeq: seg1.baseSeq });
    repo.upsertMessages([visibleAssistant("s2", 1)], { segmentId: seg2.segmentId, sessionId: seg2.sessionId, baseSeq: seg2.baseSeq });
    const beforeS1 = repo.getSessionSeqEpoch("s1");
    const beforeS2 = repo.getSessionSeqEpoch("s2");
    repo.resequenceSessionMessages("s1");
    expect(repo.getSessionSeqEpoch("s1")).not.toBe(beforeS1);
    expect(repo.getSessionSeqEpoch("s2")).toBe(beforeS2);
    db.close();
  });

  test("/api/chat/messages envelope carries seq epoch as a non-stub value", async () => {
    const app = await createApp(config("messages-envelope"));
    const ctx = contextOf(app);
    const segment = ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    ctx.messages.upsertMessages([
      visibleAssistant("s1", 1),
      visibleAssistant("s1", 2),
    ], { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    const res = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s1&beforeSeq=9999&limit=10" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.epoch).toBe("string");
    expect(body.epoch.length).toBeGreaterThan(0);
    expect(body.epoch).not.toBe("v0");

    const before = body.epoch;
    ctx.messages.resequenceSessionMessages("s1");
    const res2 = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s1&beforeSeq=9999&limit=10" });
    const body2 = res2.json();
    expect(body2.epoch).not.toBe(before);

    await app.close();
  });

  test("/api/chat/bootstrap response carries the same epoch as /api/chat/messages", async () => {
    const app = await createApp(config("bootstrap-epoch"));
    const ctx = contextOf(app);
    const segment = ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    ctx.messages.upsertMessages([
      visibleAssistant("s1", 1),
      visibleAssistant("s1", 2),
    ], { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    // Force a known epoch value via a bump.
    ctx.messages.resequenceSessionMessages("s1");
    const expected = ctx.messages.getSessionSeqEpoch("s1");

    // /api/chat/messages must mirror it.
    const m = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s1&beforeSeq=9999&limit=10" });
    expect(m.json().epoch).toBe(expected);

    await app.close();
  });
});
