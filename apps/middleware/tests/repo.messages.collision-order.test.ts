import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import type { ProjectedMessage } from "../src/features/chat/types.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-collision-order-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

function build(message: Partial<ProjectedMessage> & { sessionKey: string; openclawSeq: number; role: string; messageId: string; text: string; runId?: string; updatedAtMs?: number }): ProjectedMessage {
  return {
    sessionKey: message.sessionKey,
    segmentId: message.segmentId,
    sessionId: message.sessionId,
    gatewaySeq: message.gatewaySeq ?? message.openclawSeq,
    openclawSeq: message.openclawSeq,
    messageId: message.messageId,
    role: message.role,
    data: {
      role: message.role,
      text: message.text,
      __openclaw: {
        id: message.messageId,
        seq: message.openclawSeq,
        gatewaySeq: message.gatewaySeq ?? message.openclawSeq,
        ...(message.runId ? { runId: message.runId } : {}),
      },
    },
    updatedAtMs: message.updatedAtMs ?? Date.now(),
  };
}

describe("upsertMessages collision order — late gateway user echo", () => {
  test("late user echo at a seq held by assistant+tool rows keeps user at that seq and shifts the assistant/tool block by +1", () => {
    const db = openDatabase({ databasePath: testDbPath("late-user-echo") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "sid-1" });
    const opts = { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq };

    // 1) Live assistant arrives first at seq 10 — no preceding user echo yet.
    //    Real live rows carry a runId in __openclaw so the projection can
    //    correlate them with the active run; the shift path keys off that
    //    runId to avoid disturbing unrelated historical turns.
    const assistantFirst = repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "assistant", messageId: "assistant-1", text: "assistant answer", runId: "run-1" }),
    ], opts);
    expect(assistantFirst.upserted).toBe(1);

    // 2) Tool result arrives at seq 11.
    const toolFirst = repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 11, role: "toolResult", messageId: "tool-1", text: "tool result text", runId: "run-1" }),
    ], opts);
    expect(toolFirst.upserted).toBe(1);

    // Verify the broken state we expect before the user echo arrives.
    let rows = repo.listMessages("s1");
    expect(rows.map((r) => ({ seq: r.openclawSeq, role: r.role, messageId: r.messageId }))).toEqual([
      { seq: 10, role: "assistant", messageId: "assistant-1" },
      { seq: 11, role: "toolResult", messageId: "tool-1" },
    ]);

    // 3) Late gateway user echo arrives, claiming seq 10 — the seq it SHOULD
    //    have occupied if it hadn't been delayed by session-switch-during-
    //    generation. Old behavior: bumped to seq 12 (end). New behavior:
    //    keep user at 10, shift assistant -> 11, tool -> 12.
    const userEcho = repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "user", messageId: "user-1", text: "the user question" }),
    ], opts);

    rows = repo.listMessages("s1");
    expect(rows.map((r) => ({ seq: r.openclawSeq, role: r.role, messageId: r.messageId, text: (r.data as { text?: string }).text }))).toEqual([
      { seq: 10, role: "user", messageId: "user-1", text: "the user question" },
      { seq: 11, role: "assistant", messageId: "assistant-1", text: "assistant answer" },
      { seq: 12, role: "toolResult", messageId: "tool-1", text: "tool result text" },
    ]);

    // changedMessages MUST include all three rows: the new user, plus the two
    // shifted rows (their openclaw_seq changed — projection cache / SSE
    // consumers need to see them).
    const changedSeqs = userEcho.changedMessages
      .map((m) => ({ seq: m.openclawSeq, role: m.role, messageId: m.messageId }))
      .sort((a, b) => a.seq - b.seq);
    expect(changedSeqs).toEqual([
      { seq: 10, role: "user", messageId: "user-1" },
      { seq: 11, role: "assistant", messageId: "assistant-1" },
      { seq: 12, role: "toolResult", messageId: "tool-1" },
    ]);
    expect(userEcho.lastSeq).toBe(12);

    db.close();
  });

  test("late user echo does NOT disturb a prior user turn earlier in the segment", () => {
    const db = openDatabase({ databasePath: testDbPath("preserve-earlier-user") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "sid-1" });
    const opts = { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq };

    repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 1, role: "user", messageId: "user-0", text: "first question" }),
      build({ sessionKey: "s1", openclawSeq: 2, role: "assistant", messageId: "assistant-0", text: "first answer" }),
    ], opts);

    // Live assistant + tool for SECOND turn arrive at seqs 10, 11 before the
    // gateway user echo. They carry the active run id.
    repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "assistant", messageId: "assistant-1", text: "second answer", runId: "run-2" }),
      build({ sessionKey: "s1", openclawSeq: 11, role: "toolResult", messageId: "tool-1", text: "second tool", runId: "run-2" }),
    ], opts);

    repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "user", messageId: "user-1", text: "second question" }),
    ], opts);

    const rows = repo.listMessages("s1");
    expect(rows.map((r) => ({ seq: r.openclawSeq, role: r.role, messageId: r.messageId }))).toEqual([
      { seq: 1, role: "user", messageId: "user-0" },
      { seq: 2, role: "assistant", messageId: "assistant-0" },
      { seq: 10, role: "user", messageId: "user-1" },
      { seq: 11, role: "assistant", messageId: "assistant-1" },
      { seq: 12, role: "toolResult", messageId: "tool-1" },
    ]);

    db.close();
  });

  test("user echo collision against an assistant row WITHOUT live-run identity falls back to append (does not reorder unrelated history)", () => {
    // Guard against accidentally reordering historical/replayed assistant
    // rows that have no runId. The shift path only fires when the existing
    // row clearly belongs to a live in-flight run.
    const db = openDatabase({ databasePath: testDbPath("no-run-id-fallback") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "sid-1" });
    const opts = { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq };

    // No runId on the assistant row — simulates a synthetic / replayed-from-
    // history row without active-run metadata.
    repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "assistant", messageId: "assistant-historical", text: "old answer" }),
    ], opts);

    repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "user", messageId: "user-late", text: "late echo" }),
    ], opts);

    const rows = repo.listMessages("s1");
    // Assistant stays at seq 10; the user is appended (fallback to old behavior).
    expect(rows.find((r) => r.messageId === "assistant-historical")?.openclawSeq).toBe(10);
    expect(rows.find((r) => r.messageId === "user-late")?.openclawSeq).toBeGreaterThan(10);

    db.close();
  });

  test("late user echo tight against the next user/system row keeps the user ABOVE its assistant (no inversion)", () => {
    // Tight-boundary case: a next user/system row already exists at seq 12 with
    // the run's assistant/tool packed at 10..11. The previous fallback appended
    // the late user echo to the END (seq 13), rendering it AFTER its own
    // assistant turn (and after the next turn) — a user-after-assistant
    // INVERSION. The fix extends the negative-sentinel shift to the whole tail
    // so the user keeps seq 10 and every later row (incl. the next-turn user)
    // shifts +1, preserving relative order without violating the PK.
    const db = openDatabase({ databasePath: testDbPath("tight-boundary-no-inversion") });
    const repo = new MessageRepository(db);
    const segment = repo.ensureActiveSegment({ sessionKey: "s1", sessionId: "sid-1" });
    const opts = { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq };

    repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "assistant", messageId: "assistant-1", text: "a", runId: "run-tight" }),
      build({ sessionKey: "s1", openclawSeq: 11, role: "toolResult", messageId: "tool-1", text: "t", runId: "run-tight" }),
      build({ sessionKey: "s1", openclawSeq: 12, role: "user", messageId: "user-next", text: "next q" }),
    ], opts);

    const late = repo.upsertMessages([
      build({ sessionKey: "s1", openclawSeq: 10, role: "user", messageId: "user-late", text: "late echo" }),
    ], opts);

    const rows = repo.listMessages("s1");
    const seqOf = (id: string) => rows.find((r) => r.messageId === id)?.openclawSeq;

    // Correct chronological order — the late user echo precedes its assistant,
    // and the unrelated next turn keeps its RELATIVE position (just shifted +1).
    expect(rows.map((r) => ({ seq: r.openclawSeq, messageId: r.messageId }))).toEqual([
      { seq: 10, messageId: "user-late" },
      { seq: 11, messageId: "assistant-1" },
      { seq: 12, messageId: "tool-1" },
      { seq: 13, messageId: "user-next" },
    ]);
    // The core invariant: the user is never below its own assistant.
    expect(seqOf("user-late")!).toBeLessThan(seqOf("assistant-1")!);
    // The insert plus every shifted tail row are written (>=1).
    expect(late.upserted).toBeGreaterThanOrEqual(1);
    // All shifted rows are surfaced so projection/SSE consumers see the moves.
    const changed = late.changedMessages.map((m) => m.messageId).sort();
    expect(changed).toEqual(["assistant-1", "tool-1", "user-late", "user-next"].sort());

    db.close();
  });
});
