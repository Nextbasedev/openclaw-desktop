import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { buildChatBootstrapSnapshot } from "../src/features/chat/projection.js";
import type { AppContext } from "../src/app.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-snap-scope-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

function snapshotArgs(sessionKey: string) {
  return {
    sessionKey,
    sessionId: "sid",
    sessionData: { status: "done" } as Record<string, unknown>,
    messages: [] as unknown[],
    messageCount: 0,
    cursor: 0,
    projection: { upserted: 0, lastSeq: 0, liveSubscribed: false },
  };
}

describe("bootstrap snapshot tool scoping (P2.7)", () => {
  test("terminal session exposes latest-run tools plus historical subagent tools only", () => {
    const db = openDatabase({ databasePath: testDbPath("terminal") });
    const runs = new RunRepository(db);
    const context = { runs } as unknown as AppContext;
    runs.upsertRun({ runId: "r-old", sessionKey: "s1", status: "done", startedAtMs: 100, updatedAtMs: 200 });
    runs.upsertRun({ runId: "r-done", sessionKey: "s1", status: "done", startedAtMs: 300, updatedAtMs: 400 });
    runs.upsertToolCall({ sessionKey: "s1", runId: "r-old", toolCallId: "h1", name: "search", phase: "result", status: "success", startedAtMs: 50, updatedAtMs: 60 });
    runs.upsertToolCall({ sessionKey: "s1", runId: "r-done", toolCallId: "latest-1", name: "fetch", phase: "result", status: "success", startedAtMs: 350, updatedAtMs: 360 });
    runs.upsertToolCall({ sessionKey: "s1", runId: "r-old", toolCallId: "spawn-1", name: "sessions_spawn", phase: "result", status: "success", startedAtMs: 70, updatedAtMs: 80 });

    const snapshot = buildChatBootstrapSnapshot(context, snapshotArgs("s1"));
    expect(snapshot.tools.map((t) => t.toolCallId).sort()).toEqual(["latest-1", "spawn-1"]);
    expect(snapshot).not.toHaveProperty("toolCalls");
    db.close();
  });

  test("live active run keeps strict run-scoping (does not leak detached historical tools)", () => {
    const db = openDatabase({ databasePath: testDbPath("active") });
    const runs = new RunRepository(db);
    const context = { runs } as unknown as AppContext;
    runs.upsertRun({ runId: "r-live", sessionKey: "s1", status: "thinking", startedAtMs: 1000, updatedAtMs: 1000 });
    runs.upsertToolCall({ sessionKey: "s1", runId: "r-live", toolCallId: "live-1", name: "search", phase: "start", startedAtMs: 1010, updatedAtMs: 1010 });
    // A stale detached historical tool that must NOT appear while a run is live.
    runs.upsertToolCall({ sessionKey: "s1", toolCallId: "old-1", name: "fetch", phase: "result", status: "success", startedAtMs: 50, updatedAtMs: 60 });

    const snapshot = buildChatBootstrapSnapshot(context, snapshotArgs("s1"));
    expect(snapshot.tools.map((t) => t.toolCallId)).toEqual(["live-1"]);
    db.close();
  });
});
