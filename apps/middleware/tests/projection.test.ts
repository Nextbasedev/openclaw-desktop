import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { CHAT_PROJECTION_VERSION, CHAT_PROJECTION_VERSION_META_KEY, chatProjectionResyncRequiredMetaKey } from "../src/db/chat-projection-version.js";
import { readSchemaVersion } from "../src/db/migrate.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { runStatusLabel } from "../src/features/chat/projection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("SQLite projection", () => {
  test("migration creates schema version", () => {
    const db = openDatabase({ databasePath: testDbPath("schema") });
    expect(readSchemaVersion(db)).toBe(2);
    db.close();
  });

  test("migration projection version gate clears trusted gateway offsets", () => {
    const databasePath = testDbPath("projection-version-gate");
    const seed = new Database(databasePath);
    seed.exec(`
      CREATE TABLE v2_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE v2_gateway_offsets (session_key TEXT PRIMARY KEY, last_openclaw_seq INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL);
    `);
    seed.prepare("INSERT INTO v2_meta(key, value) VALUES (?, ?)").run(CHAT_PROJECTION_VERSION_META_KEY, String(CHAT_PROJECTION_VERSION - 1));
    seed.exec("CREATE TABLE v2_sessions (session_key TEXT PRIMARY KEY, session_id TEXT, data_json TEXT NOT NULL, updated_at_ms INTEGER NOT NULL)");
    seed.prepare("INSERT INTO v2_sessions(session_key, session_id, data_json, updated_at_ms) VALUES ('s1', 'sid-1', '{}', 100)").run();
    seed.prepare("INSERT INTO v2_gateway_offsets(session_key, last_openclaw_seq, updated_at_ms) VALUES ('s1', 42, 100)").run();
    seed.close();

    const db = openDatabase({ databasePath });
    expect(db.prepare("SELECT count(*) AS count FROM v2_gateway_offsets").get()).toMatchObject({ count: 0 });
    expect(db.prepare("SELECT value FROM v2_meta WHERE key = ?").get(CHAT_PROJECTION_VERSION_META_KEY)).toMatchObject({ value: String(CHAT_PROJECTION_VERSION) });
    expect(db.prepare("SELECT value FROM v2_meta WHERE key = ?").get(chatProjectionResyncRequiredMetaKey("s1"))).toMatchObject({ value: String(CHAT_PROJECTION_VERSION) });
    db.close();
  });

  test("history normalization drops blank assistant retry shells but keeps errors and tools", () => {
    const normalized = normalizeHistoryMessages("s1", [
      { role: "user", content: [{ type: "text", text: "image prompt" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }], __openclaw: { id: "u1", seq: 1 } },
      { role: "assistant", content: [], __openclaw: { id: "blank", seq: 2 } },
      { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "session_status", arguments: {} }], __openclaw: { id: "tool", seq: 3 } },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "provider failed", __openclaw: { id: "error", seq: 4 } },
    ]);

    expect(normalized.map((message) => message.messageId)).toEqual(["u1", "tool", "error"]);
  });

  test("collapses image fallback retry attempts into one successful transcript turn", () => {
    const imageUser = (id: string, seq: number) => ({
      role: "user",
      content: [{ type: "text", text: "analyze image\n\n[Attached image: bad.png]" }, { type: "image", mimeType: "image/png", omitted: true }],
      __openclaw: { id, seq },
    });
    const error = (id: string, seq: number, model: string) => ({ role: "assistant", content: [], stopReason: "error", errorMessage: `400 ${model}`, model, __openclaw: { id, seq } });
    const normalized = normalizeHistoryMessages("s1", [
      imageUser("u1", 1),
      error("e1", 2, "primary"),
      imageUser("u2", 3),
      error("e2", 4, "fallback"),
      { role: "assistant", content: [{ type: "text", text: "fallback worked" }], __openclaw: { id: "a-final", seq: 5 } },
    ]);

    expect(normalized.map((message) => message.messageId)).toEqual(["u1", "a-final"]);
  });

  test("collapses all-failed image fallback attempts to one user and one final error", () => {
    const normalized = normalizeHistoryMessages("s1", [
      { role: "user", content: [{ type: "text", text: "analyze image\n\n[Attached image: bad.png]" }, { type: "image", mimeType: "image/png", omitted: true }], __openclaw: { id: "u1", seq: 1 } },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "primary failed", __openclaw: { id: "e1", seq: 2 } },
      { role: "user", content: [{ type: "text", text: "analyze image\n\n[Attached image: bad.png]" }, { type: "image", mimeType: "image/png", omitted: true }], __openclaw: { id: "u2", seq: 3 } },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "fallback failed", __openclaw: { id: "e2", seq: 4 } },
    ]);

    expect(normalized.map((message) => message.messageId)).toEqual(["u1", "e2"]);
    expect(normalized[1]?.data).toMatchObject({ errorMessage: "fallback failed" });
  });

  test("drops late image fallback errors after the next user when a later fallback succeeds", () => {
    const normalized = normalizeHistoryMessages("s1", [
      { role: "user", content: [{ type: "text", text: "bad image\n\n[Attached image: bad.png]" }, { type: "image", mimeType: "image/png", omitted: true }], __openclaw: { id: "img-user", seq: 1 } },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "image invalid", __openclaw: { id: "img-error-1", seq: 2 } },
      { role: "user", content: "next text turn", __openclaw: { id: "text-user", seq: 3 } },
      { role: "assistant", content: [], stopReason: "error", errorMessage: "late image fallback error", __openclaw: { id: "img-error-2", seq: 4 } },
      { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "session_status", arguments: {} }], __openclaw: { id: "text-tool", seq: 5 } },
      { role: "assistant", content: [{ type: "text", text: "next text succeeded" }], __openclaw: { id: "text-final", seq: 6 } },
    ]);

    expect(normalized.map((message) => message.messageId)).toEqual(["img-user", "text-user", "text-tool", "text-final"]);
  });

  test("message upsert is keyed by session and OpenClaw seq", () => {
    const db = openDatabase({ databasePath: testDbPath("upsert") });
    const repo = new MessageRepository(db);
    const first = normalizeHistoryMessages("s1", [
      { role: "user", content: "hello", __openclaw: { id: "a", seq: 1 } },
    ], 100);
    const second = normalizeHistoryMessages("s1", [
      { role: "user", content: "hello edited", __openclaw: { id: "a", seq: 1 } },
    ], 200);
    repo.upsertMessages(first);
    repo.upsertMessages(second);
    const rows = repo.listMessages("s1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.data).toMatchObject({ content: "hello edited" });
    db.close();
  });

  test("can read the latest limited messages in chronological order", () => {
    const db = openDatabase({ databasePath: testDbPath("latest-messages") });
    const repo = new MessageRepository(db);
    repo.upsertMessages(normalizeHistoryMessages("s1", Array.from({ length: 65 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`,
      __openclaw: { id: `m${index}`, seq: index },
    }))));

    const rows = repo.listMessages("s1", { limit: 60, latest: true });

    expect(rows).toHaveLength(60);
    expect(rows[0]?.messageId).toBe("m5");
    expect(rows.at(-1)?.messageId).toBe("m64");
    expect(rows.map((row) => row.openclawSeq)).toEqual(
      [...rows].map((row) => row.openclawSeq).sort((a, b) => a - b)
    );
    db.close();
  });

  test("can read older messages before a sequence in chronological order", () => {
    const db = openDatabase({ databasePath: testDbPath("before-seq-messages") });
    const repo = new MessageRepository(db);
    repo.upsertMessages(normalizeHistoryMessages("s1", Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      text: `message ${index}`,
      __openclaw: { id: `m${index}`, seq: index + 1 },
    }))));

    const rows = repo.listMessages("s1", { beforeSeq: 15, limit: 5 });

    expect(rows.map((row) => row.openclawSeq)).toEqual([10, 11, 12, 13, 14]);
    expect(rows[0]?.messageId).toBe("m9");
    expect(rows.at(-1)?.messageId).toBe("m13");
    db.close();
  });

  test("session id changes create a new history segment without overwriting old messages", () => {
    const db = openDatabase({ databasePath: testDbPath("segments-reset") });
    const repo = new MessageRepository(db);

    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "old user", __openclaw: { id: "old-u", seq: 1 } },
      { role: "assistant", text: "old assistant", __openclaw: { id: "old-a", seq: 2 } },
    ]), { sessionId: "sid-old" });

    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "new user", __openclaw: { id: "new-u", seq: 1 } },
      { role: "assistant", text: "new assistant", __openclaw: { id: "new-a", seq: 2 } },
    ]), { sessionId: "sid-new" });

    const rows = repo.listMessages("s1");
    expect(rows.map((row) => row.data.text)).toEqual(["old user", "old assistant", "new user", "new assistant"]);
    expect(rows.map((row) => row.openclawSeq)).toEqual([1, 2, 3, 4]);
    expect(rows.map((row) => row.gatewaySeq)).toEqual([1, 2, 1, 2]);
    expect(repo.listMessages("s1", { latest: true, limit: 2 }).map((row) => row.data.text)).toEqual(["new user", "new assistant"]);
    expect(db.prepare("SELECT count(*) AS count FROM v2_chat_segments WHERE session_key = ?").get("s1")).toMatchObject({ count: 2 });
    db.close();
  });

  test("normalizer preserves message id fields and explicit fallback seq", () => {
    const rows = normalizeHistoryMessages("s1", [
      { id: "gateway-a", role: "assistant", text: "a" },
      { messageId: "gateway-b", role: "assistant", text: "b" },
    ], 100, 7);
    expect(rows).toMatchObject([
      { openclawSeq: 7, messageId: "gateway-a" },
      { openclawSeq: 8, messageId: "gateway-b" },
    ]);
  });

  test("normalizer hides internal subagent completion messages from parent projection", () => {
    const rows = normalizeHistoryMessages("parent", [
      { id: "visible-user", role: "user", text: "run the task", __openclaw: { seq: 1 } },
      {
        id: "internal-subagent-completion",
        role: "user",
        text: "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent\nSUBAGENT_TOOL_CALL_1\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
        provenance: { kind: "inter_session", sourceSessionKey: "agent:main:subagent:child", sourceTool: "subagent_announce" },
        __openclaw: { seq: 2 },
      },
      { id: "visible-assistant", role: "assistant", text: "done", __openclaw: { seq: 3 } },
    ], 100, 1);

    expect(rows.map((row) => row.messageId)).toEqual(["visible-user", "visible-assistant"]);
  });

  test("message repository hides already-persisted internal subagent completion messages", () => {
    const db = openDatabase({ databasePath: testDbPath("hide-persisted-subagent-completion") });
    const repo = new MessageRepository(db);
    repo.upsertMessages([
      {
        sessionKey: "parent",
        openclawSeq: 1,
        messageId: "visible-user",
        role: "user",
        data: { id: "visible-user", role: "user", text: "run the task" },
        updatedAtMs: 100,
      },
      {
        sessionKey: "parent",
        openclawSeq: 2,
        messageId: "internal-subagent-completion",
        role: "user",
        data: {
          id: "internal-subagent-completion",
          role: "user",
          text: "<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent\nSUBAGENT_TOOL_CALL_1\n<<<END_OPENCLAW_INTERNAL_CONTEXT>>>",
          provenance: { kind: "inter_session", sourceSessionKey: "agent:main:subagent:child", sourceTool: "subagent_announce" },
        },
        updatedAtMs: 200,
      },
    ]);

    expect(repo.listMessages("parent").map((row) => row.messageId)).toEqual(["visible-user"]);
    db.close();
  });

  test("run projection stores send identity and terminal status", () => {
    const db = openDatabase({ databasePath: testDbPath("runs") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "run:stable", sessionKey: "s1", clientMessageId: "client-1", idempotencyKey: "stable", status: "thinking", startedAtMs: 100, updatedAtMs: 100 });
    repo.upsertRun({ runId: "run:stable", sessionKey: "s1", gatewayRunId: "gateway-run-1", status: "streaming", updatedAtMs: 200 });
    repo.updateRunStatus("run:stable", "done", { updatedAtMs: 300 });

    expect(repo.findRunByClientMessage("s1", "client-1")).toMatchObject({ runId: "run:stable", gatewayRunId: "gateway-run-1", status: "done", finishedAtMs: 300 });
    expect(repo.findRunByIdempotencyKey("s1", "stable")).toMatchObject({ runId: "run:stable" });
    db.close();
  });

  test("tool projection upserts lifecycle by session and toolCallId", () => {
    const db = openDatabase({ databasePath: testDbPath("tools") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "r1", sessionKey: "s1", status: "thinking" });
    repo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-1", name: "search", phase: "start", startedAtMs: 100, updatedAtMs: 100 });
    repo.upsertToolCall({ sessionKey: "s1", runId: "r1", toolCallId: "tool-1", phase: "result", resultMeta: { count: 3 }, updatedAtMs: 200 });

    expect(repo.listToolCalls("s1", "r1")).toEqual([
      expect.objectContaining({ toolCallId: "tool-1", name: "search", status: "success", resultMeta: { count: 3 }, finishedAtMs: 200 }),
    ]);
    expect(repo.hasRunningTools("s1", "r1")).toBe(false);
    db.close();
  });

  test("stale activity cleanup finalizes old runs and running tools", () => {
    const db = openDatabase({ databasePath: testDbPath("stale-activity") });
    const repo = new RunRepository(db);
    repo.upsertRun({ runId: "old-run", sessionKey: "s1", status: "tool_running", startedAtMs: 1_000, updatedAtMs: 1_000 });
    repo.upsertToolCall({ sessionKey: "s1", runId: "old-run", toolCallId: "old-tool", name: "read", phase: "start", startedAtMs: 1_000, updatedAtMs: 1_000 });

    const result = repo.finalizeStaleActivity({ nowMs: 10_000, activeRunMs: 1_000, runningToolMs: 1_000 });

    expect(result).toMatchObject({ runsFinalized: 1, toolsFinalized: 1 });
    expect(repo.latestRun("s1")).toMatchObject({ status: "done", finishedAtMs: 10_000 });
    expect(repo.listToolCalls("s1", "old-run")).toEqual([
      expect.objectContaining({ toolCallId: "old-tool", status: "success", phase: "result", finishedAtMs: 10_000 }),
    ]);
    db.close();
  });

  test("confirming optimistic user preserves canonical client id and records gateway identity", () => {
    const db = openDatabase({ databasePath: testDbPath("confirm-user") });
    const repo = new MessageRepository(db);
    repo.insertOptimisticMessage({ sessionKey: "s1", openclawSeq: 1, messageId: "client-1", role: "user", data: { role: "user", text: "hello", __clientOptimistic: true, __openclaw: { id: "client-1" } }, updatedAtMs: 100 });
    const [gateway] = normalizeHistoryMessages("s1", [{ role: "user", text: "> prior\n\nhello", __openclaw: { id: "gateway-user-1", seq: 7 } }], 200);
    const confirmed = repo.confirmOptimisticUser("s1", "client-1", gateway!);

    expect(confirmed).toMatchObject({ messageId: "client-1", openclawSeq: 1, data: { __clientOptimistic: false, __openclaw: { id: "client-1", gatewayId: "gateway-user-1", gatewaySeq: 7 } } });
    expect(repo.listMessages("s1")).toHaveLength(1);
    db.close();
  });

  test("confirmed optimistic user is not duplicated when old history replay arrives after recent echo TTL", () => {
    const db = openDatabase({ databasePath: testDbPath("confirmed-user-gateway-seq-replay") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "gateway-session" });
    repo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "heavy turn 1", __clientOptimistic: true, __openclaw: { id: "client-1" } },
      updatedAtMs: 100,
    });
    const [gatewayUser] = normalizeHistoryMessages("s1", [
      { role: "user", text: "heavy turn 1", __openclaw: { id: "gateway-user-1", seq: 7 } },
    ], 200);
    repo.confirmOptimisticUser("s1", "client-1", gatewayUser!);
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "assistant", text: "answer 1", __openclaw: { id: "assistant-1", seq: 8 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    const replay = repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "heavy turn 1", __openclaw: { id: "gateway-user-1-replayed", seq: 7 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    expect(replay.upserted).toBe(0);
    expect(repo.listMessages("s1").map((message) => `${message.openclawSeq}:${message.role}:${message.messageId}:${(message.data as { text?: string }).text ?? ""}`)).toEqual([
      "1:user:client-1:heavy turn 1",
      "8:assistant:assistant-1:answer 1",
    ]);
    db.close();
  });

  test("15 sequential tool turns keep exactly one user and one final per turn after heavy history replay", () => {
    const db = openDatabase({ databasePath: testDbPath("heavy-15-turn-replay") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "gateway-session" });

    for (let turn = 1; turn <= 15; turn += 1) {
      const gatewaySeq = ((turn - 1) * 4) + 1;
      const marker = `SEQ_HEAVY_FINAL_test_${String(turn).padStart(2, "0")}`;
      repo.insertOptimisticMessage({
        sessionKey: "s1",
        openclawSeq: repo.nextMessageSeq("s1"),
        messageId: `client-${turn}`,
        role: "user",
        data: { role: "user", text: `heavy turn ${turn}`, __clientOptimistic: true, __openclaw: { id: `client-${turn}` } },
        updatedAtMs: 100 + turn,
      });
      const [gatewayUser] = normalizeHistoryMessages("s1", [
        { role: "user", text: `heavy turn ${turn}`, __openclaw: { id: `gateway-user-${turn}`, seq: gatewaySeq } },
      ], 200 + turn);
      repo.confirmOptimisticUser("s1", `client-${turn}`, gatewayUser!);
      repo.upsertMessages(normalizeHistoryMessages("s1", [
        { role: "assistant", content: [{ type: "tool_call", id: `tool-${turn}`, name: "session_status", input: {} }], __openclaw: { id: `assistant-tool-${turn}`, seq: gatewaySeq + 1 } },
        { role: "toolResult", tool_call_id: `tool-${turn}`, content: "ok", __openclaw: { id: `tool-result-${turn}`, seq: gatewaySeq + 2 } },
        { role: "assistant", text: `done ${marker}`, __openclaw: { id: `assistant-final-${turn}`, seq: gatewaySeq + 3 } },
      ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    }

    const heavyReplay = [];
    for (let turn = 1; turn <= 15; turn += 1) {
      const gatewaySeq = ((turn - 1) * 4) + 1;
      const marker = `SEQ_HEAVY_FINAL_test_${String(turn).padStart(2, "0")}`;
      heavyReplay.push(
        { role: "user", text: `heavy turn ${turn}`, __openclaw: { id: `gateway-user-${turn}-late-replay`, seq: gatewaySeq } },
        { role: "assistant", content: [{ type: "tool_call", id: `tool-${turn}`, name: "session_status", input: {} }], __openclaw: { id: `assistant-tool-${turn}`, seq: gatewaySeq + 1 } },
        { role: "toolResult", tool_call_id: `tool-${turn}`, content: "ok", __openclaw: { id: `tool-result-${turn}`, seq: gatewaySeq + 2 } },
        { role: "assistant", text: `done ${marker}`, __openclaw: { id: `assistant-final-${turn}`, seq: gatewaySeq + 3 } },
      );
    }
    repo.upsertMessages(normalizeHistoryMessages("s1", heavyReplay), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    const rows = repo.listMessages("s1");
    const users = rows.filter((message) => message.role === "user" && ((message.data as { text?: string }).text ?? "").startsWith("heavy turn "));
    const finals = rows.filter((message) => message.role === "assistant" && ((message.data as { text?: string }).text ?? "").includes("SEQ_HEAVY_FINAL_test_"));
    const finalMarkers = finals.map((message) => ((message.data as { text?: string }).text ?? "").match(/SEQ_HEAVY_FINAL_test_\d+/)?.[0]).filter(Boolean);

    expect(users).toHaveLength(15);
    expect(finals).toHaveLength(15);
    expect(new Set(finalMarkers).size).toBe(15);
    expect(rows.filter((message) => message.role === "toolResult")).toHaveLength(15);
    db.close();
  });

  test("45 sequential turns ignore stripped late replays even when gateway seq changes", () => {
    const db = openDatabase({ databasePath: testDbPath("heavy-45-stripped-replay-new-gateway-seq") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "gateway-session" });

    for (let turn = 1; turn <= 45; turn += 1) {
      const marker = `COZY_STRUCTURAL_45_TURN_${String(turn).padStart(2, "0")}_FINAL`;
      repo.insertOptimisticMessage({
        sessionKey: "s1",
        openclawSeq: repo.nextMessageSeq("s1"),
        messageId: `client-${turn}`,
        role: "user",
        data: { role: "user", text: `Production regression turn ${turn}/45 ${marker}`, __clientOptimistic: true, __openclaw: { id: `client-${turn}`, runId: `run-${turn}` } },
        updatedAtMs: 100 + turn,
      });
      const [gatewayUser] = normalizeHistoryMessages("s1", [
        { role: "user", text: `Production regression turn ${turn}/45 ${marker}`, __openclaw: { id: `gateway-user-${turn}`, seq: turn * 3 } },
      ], 200 + turn);
      repo.confirmOptimisticUser("s1", `client-${turn}`, gatewayUser!);
      repo.upsertMessages(normalizeHistoryMessages("s1", [
        { role: "assistant", text: marker, __openclaw: { id: `assistant-final-${turn}`, seq: turn * 3 + 1, runId: `run-${turn}` } },
      ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    }

    const strippedReplay = [];
    for (const turn of [2, 8, 12, 15, 19, 25, 43]) {
      const marker = `COZY_STRUCTURAL_45_TURN_${String(turn).padStart(2, "0")}_FINAL`;
      strippedReplay.push(
        { role: "user", text: `Production regression turn ${turn}/45 ${marker}`, __openclaw: { id: `random-user-${turn}`, seq: 100 + turn } },
        { role: "assistant", text: marker, __openclaw: { id: `random-assistant-${turn}`, seq: 200 + turn } },
      );
    }
    const replay = repo.upsertMessages(normalizeHistoryMessages("s1", strippedReplay), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    expect(replay.upserted).toBe(0);
    const rows = repo.listMessages("s1");
    const users = rows.filter((message) => message.role === "user" && ((message.data as { text?: string }).text ?? "").startsWith("Production regression turn "));
    const finals = rows.filter((message) => message.role === "assistant" && ((message.data as { text?: string }).text ?? "").includes("COZY_STRUCTURAL_45_TURN_"));
    expect(users).toHaveLength(45);
    expect(finals).toHaveLength(45);
    for (let turn = 1; turn <= 45; turn += 1) {
      const marker = `COZY_STRUCTURAL_45_TURN_${String(turn).padStart(2, "0")}_FINAL`;
      expect(users.filter((message) => ((message.data as { text?: string }).text ?? "").includes(marker))).toHaveLength(1);
      expect(finals.filter((message) => ((message.data as { text?: string }).text ?? "").includes(marker))).toHaveLength(1);
    }
    db.close();
  });

  test("confirming optimistic user keeps its local canonical seq before late prior assistant history", () => {
    const db = openDatabase({ databasePath: testDbPath("confirm-user-local-seq") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "gateway-session" });
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "hello", __openclaw: { id: "gateway-user-1", seq: 1 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    repo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 2,
      messageId: "client-2",
      role: "user",
      data: { role: "user", text: "generate 100 words content", __clientOptimistic: true, __openclaw: { id: "client-2" } },
      updatedAtMs: 100,
    });
    const [gatewayUser] = normalizeHistoryMessages("s1", [
      { role: "user", text: "generate 100 words content", __openclaw: { id: "gateway-user-2", seq: 3 } },
    ], 200);

    const confirmed = repo.confirmOptimisticUser("s1", "client-2", gatewayUser!);
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "assistant", text: "Hello Krish 👋", __openclaw: { id: "assistant-1", seq: 2 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    expect(confirmed).toMatchObject({ messageId: "client-2", openclawSeq: 2 });
    expect(repo.listMessages("s1").map((message) => `${message.role}:${(message.data as { text?: string }).text ?? (message.data as { content?: string }).content ?? ""}`)).toEqual([
      "user:hello",
      "user:generate 100 words content",
      "assistant:Hello Krish 👋",
    ]);
    db.close();
  });

  test("confirming optimistic user does not overshoot into baseSeq plus gatewaySeq collisions", () => {
    const db = openDatabase({ databasePath: testDbPath("confirm-user-no-overshoot-collision") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "gateway-session" });
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "archived 1", __openclaw: { id: "archived-1", seq: 1 } },
      { role: "assistant", text: "archived 2", __openclaw: { id: "archived-2", seq: 2 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    repo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 3,
      messageId: "client-3",
      role: "user",
      data: { role: "user", text: "run tools", __clientOptimistic: true, __openclaw: { id: "client-3" } },
      updatedAtMs: 100,
    });
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "read", arguments: {} }], __openclaw: { id: "assistant-tool", seq: 4 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    const [gatewayUser] = normalizeHistoryMessages("s1", [
      { role: "user", text: "run tools", __openclaw: { id: "gateway-user-3", seq: 4 } },
    ], 200);

    const confirmed = repo.confirmOptimisticUser("s1", "client-3", gatewayUser!);

    expect(confirmed).toMatchObject({ messageId: "client-3", openclawSeq: 3 });
    expect(repo.listMessages("s1").map((message) => `${message.openclawSeq}:${message.role}:${message.messageId}`)).toEqual([
      "1:user:archived-1",
      "2:assistant:archived-2",
      "3:user:client-3",
      "4:assistant:assistant-tool",
    ]);
    db.close();
  });

  test("confirming optimistic user keeps newer imported-chat optimistic row when gateway seq is older", () => {
    const db = openDatabase({ databasePath: testDbPath("confirm-user-imported-newer") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "gateway-session" });
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "archived/imported history", __openclaw: { id: "archived-100", seq: 100 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    repo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 101,
      messageId: "client-newest",
      role: "user",
      data: { role: "user", text: "WEBWRIGHT_IMPORTED_LONG newest marker", __clientOptimistic: true, __openclaw: { id: "client-newest" } },
      updatedAtMs: 100,
    });
    const [gatewayUser] = normalizeHistoryMessages("s1", [
      { role: "user", text: "WEBWRIGHT_IMPORTED_LONG newest marker", __openclaw: { id: "gateway-newest", seq: 3 } },
    ], 200);

    const confirmed = repo.confirmOptimisticUser("s1", "client-newest", gatewayUser!);
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "assistant", text: "late old history", __openclaw: { id: "assistant-old", seq: 4 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    expect(confirmed).toMatchObject({ messageId: "client-newest", openclawSeq: 101 });
    expect(repo.findMessageById("s1", "client-newest")).toMatchObject({
      openclawSeq: 101,
      role: "user",
      data: { text: "WEBWRIGHT_IMPORTED_LONG newest marker", __clientOptimistic: false },
    });
    expect(repo.listMessages("s1", { limit: 1, latest: true })[0]).toMatchObject({ messageId: "client-newest", openclawSeq: 101 });
    db.close();
  });

  test("terminal bootstrap labels ignore stale legacy thinking label", () => {
    expect(runStatusLabel("done", { runId: "r1", sessionKey: "s1", clientMessageId: null, idempotencyKey: null, gatewayRunId: null, status: "done", statusLabel: null, startedAtMs: 1, updatedAtMs: 2, finishedAtMs: 2, error: null }, "Thinking")).toBeNull();
    expect(runStatusLabel("aborted", null, "Thinking")).toBeNull();
    expect(runStatusLabel("thinking", null, "Thinking")).toBe("Thinking");
  });

  test("confirming optimistic user with empty gateway echo preserves optimistic display text", () => {
    const db = openDatabase({ databasePath: testDbPath("confirm-user-empty-echo") });
    const repo = new MessageRepository(db);
    repo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "hii", __clientOptimistic: true, __openclaw: { id: "client-1" } },
      updatedAtMs: 100,
    });
    const [gateway] = normalizeHistoryMessages("s1", [{ role: "user", __openclaw: { id: "gateway-user-1", seq: 1 } }], 200);
    const confirmed = repo.confirmOptimisticUser("s1", "client-1", gateway!);

    expect(confirmed?.data).toMatchObject({ role: "user", text: "hii", __clientOptimistic: false });
    expect(repo.listMessages("s1")[0]?.data).toMatchObject({ text: "hii", __clientOptimistic: false });
    db.close();
  });

  test("live assistant arriving before optimistic user confirmation stays after the user", () => {
    const db = openDatabase({ databasePath: testDbPath("assistant-after-optimistic-user") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "gateway-session" });
    repo.upsertMessages(normalizeHistoryMessages("s1", [
      { role: "user", text: "previous", __openclaw: { id: "u1", seq: 1 } },
      { role: "assistant", text: "previous answer", __openclaw: { id: "a1", seq: 2 } },
    ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
    repo.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 3,
      messageId: "client-2",
      role: "user",
      data: { role: "user", text: "hii", __clientOptimistic: true, __openclaw: { id: "client-2" } },
      updatedAtMs: 100,
    });

    repo.upsertMessages([{
      sessionKey: "s1",
      segmentId: segment.segmentId,
      sessionId: segment.sessionId,
      gatewaySeq: 3,
      openclawSeq: 3,
      messageId: "live-assistant",
      role: "assistant",
      data: { role: "assistant", text: "Hi Dixit 👋", __openclaw: { id: "live-assistant" } },
      updatedAtMs: 200,
    }], { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    expect(repo.listMessages("s1").map((message) => `${message.openclawSeq}:${message.role}:${(message.data as { text?: string }).text ?? ""}`)).toEqual([
      "1:user:previous",
      "2:assistant:previous answer",
      "3:user:hii",
      "4:assistant:Hi Dixit 👋",
    ]);
    db.close();
  });

  test("projection cursor increases monotonically", () => {
    const db = openDatabase({ databasePath: testDbPath("cursor") });
    const repo = new MessageRepository(db);
    const a = repo.appendProjectionEvent({ eventType: "a", payload: {} });
    const b = repo.appendProjectionEvent({ eventType: "b", payload: {} });
    expect(b.cursor).toBeGreaterThan(a.cursor);
    db.close();
  });
});
