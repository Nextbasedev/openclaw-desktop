import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { projectArchivedSegmentToolCalls } from "../src/features/chat/routes.js";
import type { AppContext } from "../src/app.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-archived-tools-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

function archiveMessages() {
  return [
    { role: "user", content: [{ type: "text", text: "do stuff" }], __openclaw: { id: "u1", seq: 1 } },
    { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "search", arguments: { q: "x" } }], __openclaw: { id: "a1", seq: 2 } },
    { role: "tool", toolCallId: "tc-1", content: "ok result", __openclaw: { id: "r1", seq: 3 } },
    { role: "assistant", content: [{ type: "toolCall", id: "tc-2", name: "fetch", arguments: { url: "y" } }], __openclaw: { id: "a2", seq: 4 } },
    { role: "tool", toolCallId: "tc-2", content: { error: "kaboom" }, __openclaw: { id: "r2", seq: 5 } },
    { role: "assistant", content: [{ type: "text", text: "done" }], __openclaw: { id: "a3", seq: 6 } },
  ];
}

describe("archived-import tool projection", () => {
  test("projects one tool row per toolCallId with paired result/status and messageId", async () => {
    const db = openDatabase({ databasePath: testDbPath("project") });
    const runs = new RunRepository(db);
    const context = { runs } as unknown as AppContext;
    const normalized = normalizeHistoryMessages("s1", archiveMessages());

    const projected = await projectArchivedSegmentToolCalls(context, "s1", normalized);
    expect(projected).toBe(2);

    const tools = runs.listToolCalls("s1");
    const byId = Object.fromEntries(tools.map((t) => [t.toolCallId, t]));
    expect(Object.keys(byId).sort()).toEqual(["tc-1", "tc-2"]);
    expect(byId["tc-1"]).toMatchObject({ name: "search", status: "success", phase: "result", messageId: "a1" });
    expect(byId["tc-2"]).toMatchObject({ name: "fetch", status: "error", messageId: "a2" });
    db.close();
  });

  test("is idempotent — re-running does not duplicate or resurrect running rows", async () => {
    const db = openDatabase({ databasePath: testDbPath("idempotent") });
    const runs = new RunRepository(db);
    const context = { runs } as unknown as AppContext;
    const normalized = normalizeHistoryMessages("s1", archiveMessages());

    await projectArchivedSegmentToolCalls(context, "s1", normalized);
    const first = runs.listToolCalls("s1");
    await projectArchivedSegmentToolCalls(context, "s1", normalized);
    const second = runs.listToolCalls("s1");

    expect(second.length).toBe(first.length);
    // Terminal results stay terminal (no running resurrection on replay).
    expect(second.every((t) => t.status === "success" || t.status === "error")).toBe(true);
    db.close();
  });
});
