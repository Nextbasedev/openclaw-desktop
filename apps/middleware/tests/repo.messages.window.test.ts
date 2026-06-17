import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import { isVisibleMessage } from "../src/features/chat/message-normalizer.js";
import type { ProjectedMessage } from "../src/features/chat/types.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-window-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

function visibleAssistant(sessionKey: string, openclawSeq: number, label: string): ProjectedMessage {
  return {
    sessionKey,
    openclawSeq,
    messageId: `vis-${label}-${openclawSeq}`,
    role: "assistant",
    data: { id: `vis-${label}-${openclawSeq}`, role: "assistant", text: `visible ${label} ${openclawSeq}` },
    updatedAtMs: openclawSeq * 1000,
  };
}

function hiddenSubagent(sessionKey: string, openclawSeq: number): ProjectedMessage {
  const id = `hidden-${openclawSeq}`;
  return {
    sessionKey,
    openclawSeq,
    messageId: id,
    role: "user",
    data: {
      id,
      role: "user",
      // Per-seq unique text so the stripped-replay dedupe path in upsertMessages
      // does not collapse them onto a single seq.
      text: `<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent\nseq:${openclawSeq}`,
      provenance: { sourceTool: "subagent_announce" },
      __openclaw: { id, runId: `hidden-run-${openclawSeq}` },
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

function hiddenAttachedFileEcho(sessionKey: string, openclawSeq: number): ProjectedMessage {
  const id = `att-echo-${openclawSeq}`;
  return {
    sessionKey,
    openclawSeq,
    messageId: id,
    role: "assistant",
    data: {
      id,
      role: "assistant",
      text: `<attached-file name="foo.txt">content</attached-file>`,
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

describe("MessageRepository window contract", () => {
  test("listVisibleWindow returns @limit visible rows even when hidden rows occupy the SQL window", () => {
    const db = openDatabase({ databasePath: testDbPath("limit-vs-hidden-filter") });
    const repo = new MessageRepository(db);
    // 5 visible rows at seqs 11..15.
    const seeds: ProjectedMessage[] = [];
    for (let i = 0; i < 5; i++) seeds.push(visibleAssistant("s1", 11 + i, "early"));
    // Now 10 hidden rows at seqs 100..109 occupy the tail.
    for (let i = 0; i < 10; i++) seeds.push(hiddenSubagent("s1", 100 + i));
    repo.upsertMessages(seeds);

    // Asking for the last 10 visible from before MAX. The whole tail is hidden.
    // Single-pass SQL LIMIT would scoop the 10 hidden tail rows and return 0
    // visible. The window contract requires we return the 5 visible early rows.
    const result = repo.listVisibleWindow("s1", { beforeSeq: 1_000_000, limit: 10 }, isVisibleMessage);
    expect(result.messages.length).toBe(5);
    expect(result.messages.map((row) => row.messageId)).toEqual([
      "vis-early-11", "vis-early-12", "vis-early-13", "vis-early-14", "vis-early-15",
    ]);
    // hasOlder should be false because we scanned the whole DB.
    expect(result.hasOlder).toBe(false);
    expect(result.oldestSeq).toBe(11);
    expect(result.newestSeq).toBe(15);
    expect(result.visibleCount).toBe(5);
    expect(result.scannedCount).toBeGreaterThanOrEqual(15);
    db.close();
  });

  test("listVisibleWindow fills the limit even when hidden rows interleave the window", () => {
    const db = openDatabase({ databasePath: testDbPath("interleaved") });
    const repo = new MessageRepository(db);
    // Pattern: at seqs 1..40, every odd is visible, every even is hidden.
    const seeds: ProjectedMessage[] = [];
    for (let i = 1; i <= 40; i++) {
      if (i % 2 === 1) seeds.push(visibleAssistant("s1", i, "mix"));
      else seeds.push(hiddenSubagent("s1", i));
    }
    repo.upsertMessages(seeds);

    const result = repo.listVisibleWindow("s1", { beforeSeq: 1_000_000, limit: 10 }, isVisibleMessage);
    expect(result.messages.length).toBe(10);
    // Last 10 visible are odd seqs 21,23,...,39.
    expect(result.messages.map((row) => row.openclawSeq)).toEqual([21, 23, 25, 27, 29, 31, 33, 35, 37, 39]);
    // There are 10 more older visible rows (seqs 1,3,5,...,19).
    expect(result.hasOlder).toBe(true);
    expect(result.hasNewer).toBe(false);
    expect(result.oldestSeq).toBe(21);
    expect(result.newestSeq).toBe(39);
    expect(result.visibleCount).toBe(10);
    db.close();
  });

  test("listVisibleWindow reports hasOlder=true when there are visible rows below oldestSeq", () => {
    const db = openDatabase({ databasePath: testDbPath("has-older") });
    const repo = new MessageRepository(db);
    const seeds: ProjectedMessage[] = [];
    for (let i = 1; i <= 50; i++) seeds.push(visibleAssistant("s1", i, "all"));
    repo.upsertMessages(seeds);
    const result = repo.listVisibleWindow("s1", { beforeSeq: 1_000_000, limit: 10 }, isVisibleMessage);
    expect(result.messages.length).toBe(10);
    expect(result.oldestSeq).toBe(41);
    expect(result.newestSeq).toBe(50);
    expect(result.hasOlder).toBe(true);
    expect(result.hasNewer).toBe(false);
    db.close();
  });

  test("listVisibleWindow with non-user attached-file echo also filtered", () => {
    const db = openDatabase({ databasePath: testDbPath("attached-file-echo") });
    const repo = new MessageRepository(db);
    const seeds: ProjectedMessage[] = [];
    for (let i = 1; i <= 5; i++) seeds.push(visibleAssistant("s1", i, "early"));
    for (let i = 0; i < 8; i++) seeds.push(hiddenAttachedFileEcho("s1", 100 + i));
    repo.upsertMessages(seeds);
    const result = repo.listVisibleWindow("s1", { beforeSeq: 1_000_000, limit: 10 }, isVisibleMessage);
    expect(result.messages.length).toBe(5);
    expect(result.messages.every((row) => !String(row.messageId ?? "").startsWith("att-echo"))).toBe(true);
    expect(result.hasOlder).toBe(false);
    db.close();
  });
});
