import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { openDatabase } from "../src/db/connection.js";
import { MessageRepository } from "../src/features/chat/repo.messages.js";
import type { ProjectedMessage } from "../src/features/chat/types.js";

function testDbPath(name: string) {
  return path.join(os.tmpdir(), `openclaw-v2-repeated-cmd-${name}-${Date.now()}-${Math.random()}.sqlite`);
}

const CARD = "OCPlatform 2026.4.23 status card";

function build(m: { sessionKey: string; openclawSeq: number; role: string; messageId: string; text: string; model?: string; runId?: string }): ProjectedMessage {
  return {
    sessionKey: m.sessionKey,
    segmentId: undefined,
    sessionId: undefined,
    gatewaySeq: m.openclawSeq,
    openclawSeq: m.openclawSeq,
    messageId: m.messageId,
    role: m.role,
    data: {
      role: m.role,
      text: m.text,
      ...(m.model ? { model: m.model, provider: "openclaw" } : {}),
      __openclaw: { id: m.messageId, seq: m.openclawSeq, gatewaySeq: m.openclawSeq, ...(m.runId ? { runId: m.runId } : {}) },
    },
    updatedAtMs: Date.now(),
  };
}
// User turns are sends and carry run identity; gateway-injected command replies
// (e.g. /status output) are run-less.
const user = (sk: string, seq: number, id: string, runId: string) => build({ sessionKey: sk, openclawSeq: seq, role: "user", messageId: id, text: "/status", runId });
const card = (sk: string, seq: number, id: string) => build({ sessionKey: sk, openclawSeq: seq, role: "assistant", messageId: id, text: CARD, model: "gateway-injected" });

function makeRepo(sk: string) {
  const repo = new MessageRepository(openDatabase({ databasePath: testDbPath(sk) }));
  const seg = repo.ensureActiveSegment({ sessionKey: sk, sessionId: "sid" });
  return { repo, opts: { segmentId: seg.segmentId, sessionId: seg.sessionId, baseSeq: seg.baseSeq } };
}
function counts(repo: MessageRepository, sk: string) {
  const rows = repo.listMessages(sk);
  return {
    users: rows.filter((r) => r.role === "user").length,
    assistants: rows.filter((r) => r.role === "assistant").length,
  };
}

describe("repeated slash command projection (regression: 2nd /status stuck on Writing)", () => {
  // The Gateway re-sends prior turns stripped (no run identity) on later sends,
  // so the projection dedups id-less/run-less rows by identical role+text to
  // avoid duplicating history. A genuinely repeated identical command has the
  // SAME role+text and used to be folded onto the first occurrence — dropping
  // the 2nd user turn AND its reply, leaving the repeat stuck on "Writing…".
  // A new user turn between the two replies now marks them as distinct runs.

  for (const [label, id1, id2] of [
    ["distinct reply ids", "gw-1", "gw-2"],
    ["colliding reply ids", "gw", "gw"],
  ] as const) {
    test(`incremental delivery keeps both replies — ${label}`, () => {
      const sk = `incr-${id1}-${id2}`;
      const { repo, opts } = makeRepo(sk);
      repo.upsertMessages([user(sk, 10, "u-1", "r1")], opts);
      repo.upsertMessages([card(sk, 11, id1)], opts);
      repo.upsertMessages([user(sk, 12, "u-2", "r2")], opts);
      repo.upsertMessages([card(sk, 13, id2)], opts);
      expect(counts(repo, sk)).toEqual({ users: 2, assistants: 2 });
    });

    test(`full-history backfill (single batch) keeps both replies — ${label}`, () => {
      const sk = `batch-${id1}-${id2}`;
      const { repo, opts } = makeRepo(sk);
      repo.upsertMessages([user(sk, 10, "u-1", "r1"), card(sk, 11, id1), user(sk, 12, "u-2", "r2"), card(sk, 13, id2)], opts);
      expect(counts(repo, sk)).toEqual({ users: 2, assistants: 2 });
    });
  }

  test("a genuine Gateway replay of ONE turn (no new user turn) still collapses", () => {
    const sk = "pure-replay";
    const { repo, opts } = makeRepo(sk);
    repo.upsertMessages([user(sk, 10, "u-1", "r1")], opts);
    repo.upsertMessages([card(sk, 11, "gw-1")], opts);
    // Gateway re-sends the same turn later: stripped user (no runId), new id/seq.
    repo.upsertMessages([build({ sessionKey: sk, openclawSeq: 20, role: "user", messageId: "u-1b", text: "/status" })], opts);
    repo.upsertMessages([card(sk, 21, "gw-2")], opts);
    expect(counts(repo, sk)).toEqual({ users: 1, assistants: 1 });
  });
});
