import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { RunRepository } from "../src/features/chat/repo.runs.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { backfillArchivedToolCalls } from "../src/features/chat/routes.js";
import type { AppContext } from "../src/app.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-tool-backfill-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

describe("backfillArchivedToolCalls", () => {
  test("projects tools from already-imported messages; second run is a no-op", async () => {
    const db = openDatabase({ databasePath: testDbPath("backfill") });
    const messages = new MessageRepository(db);
    const runs = new RunRepository(db);
    const context = { messages, runs } as unknown as AppContext;

    // Simulate a session imported before 0014: message rows exist, zero tool rows.
    // toolCall and its result are in DIFFERENT chunks-worth of messages to exercise
    // session-wide (cross-page) pairing.
    const normalized = normalizeHistoryMessages("s1", [
      { role: "assistant", content: [{ type: "toolCall", id: "tc-1", name: "search", arguments: { q: "a" } }], __openclaw: { id: "a1", seq: 1 } },
      { role: "tool", toolCallId: "tc-1", content: "good", __openclaw: { id: "r1", seq: 2 } },
      { role: "assistant", content: [{ type: "toolCall", id: "tc-2", name: "fetch", arguments: {} }], __openclaw: { id: "a2", seq: 3 } },
      { role: "tool", toolCallId: "tc-2", content: { error: "bad" }, __openclaw: { id: "r2", seq: 4 } },
    ]);
    messages.upsertMessages(normalized);
    expect(runs.countToolCalls("s1")).toBe(0);

    const projected = await backfillArchivedToolCalls(context, "s1");
    expect(projected).toBe(2);
    expect(runs.countToolCalls("s1")).toBe(2);
    const byId = Object.fromEntries(runs.listToolCalls("s1").map((t) => [t.toolCallId, t]));
    expect(byId["tc-1"]).toMatchObject({ status: "success", phase: "result" });
    expect(byId["tc-2"]).toMatchObject({ status: "error" });

    // Second run: idempotent — no new rows, no running resurrection.
    await backfillArchivedToolCalls(context, "s1");
    expect(runs.countToolCalls("s1")).toBe(2);
    expect(runs.listToolCalls("s1").every((t) => t.status !== "running")).toBe(true);
    db.close();
  });
});
