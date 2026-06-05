import Database from "better-sqlite3";
import { describe, expect, test } from "vitest";
import { migrateDatabase, readSchemaVersion } from "../src/db/migrate.js";
import { SubagentCorrelation } from "../src/features/chat/subagent-correlation.js";
import { extractSubagentSessionKey } from "../src/features/chat/subagent-session.js";

describe("subagent correlation", () => {
  test("links a discovered child to the only pending spawn", () => {
    const correlation = new SubagentCorrelation();
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1000 });

    const link = correlation.discoverChild("agent:main:desktop:subagent:child-1", 1100);

    expect(link).toMatchObject({
      parentSessionKey: "parent-1",
      toolCallId: "spawn-1",
      childSessionKey: "agent:main:desktop:subagent:child-1",
    });
    expect(correlation.discoverChild("agent:main:desktop:subagent:child-1", 1200)).toBeNull();
  });

  test("does not guess when multiple pending spawns are eligible", () => {
    const correlation = new SubagentCorrelation();
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1000 });
    correlation.registerSpawn({ parentSessionKey: "parent-2", toolCallId: "spawn-2", nowMs: 1000 });

    expect(correlation.discoverChild("agent:main:desktop:subagent:child-1", 1100)).toBeNull();
  });

  test("links a child discovered before the spawn when it is unambiguous", () => {
    const correlation = new SubagentCorrelation();
    expect(correlation.discoverChild("agent:main:desktop:subagent:child-1", 1000)).toBeNull();

    const { link } = correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1100 });

    expect(link).toMatchObject({
      parentSessionKey: "parent-1",
      toolCallId: "spawn-1",
      childSessionKey: "agent:main:desktop:subagent:child-1",
    });
  });
});

describe("subagent migration", () => {
  test("creates v2_subagents and backfills sessions_spawn tool results", () => {
    const db = new Database(":memory:");
    try {
      migrateDatabase(db);
      db.prepare(`
        INSERT INTO v2_tool_calls(tool_call_id, session_key, name, phase, status, args_meta_json, result_meta_json, started_at_ms, updated_at_ms)
        VALUES ('spawn-1', 'parent-1', 'sessions_spawn', 'result', 'success', ?, ?, 10, 20)
      `).run(JSON.stringify({ label: "Worker" }), JSON.stringify({ childSessionKey: "agent:main:desktop:subagent:child-1" }));

      migrateDatabase(db);

      expect(readSchemaVersion(db)).toBe(4);
      expect(db.prepare("SELECT parent_session_key, tool_call_id, child_session_key, label, status FROM v2_subagents").get()).toMatchObject({
        parent_session_key: "parent-1",
        tool_call_id: "spawn-1",
        child_session_key: "agent:main:desktop:subagent:child-1",
        label: "Worker",
        status: "working",
      });
    } finally {
      db.close();
    }
  });
});

describe("subagent session extraction", () => {
  test("extracts subagent keys from text and nested JSON strings", () => {
    expect(extractSubagentSessionKey("linked agent:main:desktop:subagent:child-1 ok")).toBe("agent:main:desktop:subagent:child-1");
    expect(extractSubagentSessionKey({ result: '{"childSessionKey":"agent:main:desktop:subagent:child-2"}' })).toBe("agent:main:desktop:subagent:child-2");
  });
});
