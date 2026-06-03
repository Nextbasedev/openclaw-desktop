import { beforeEach, describe, expect, it } from "vitest";
import { applyPatch, applyPatches } from "../applyPatch";
import { emptyChatState } from "../state";
import { orderedRows } from "../selectors";
import { patch, resetCursor, userCreated } from "./fixtures";

beforeEach(() => resetCursor());

/** A patch addressed to a DIFFERENT session than our store (top-level sessionKey overridden). */
const foreignUser = (text: string) => ({
  ...patch(
    "chat.user.created",
    {
      runId: "run-other",
      clientMessageId: "client:other-1",
      idempotencyKey: "other-1",
      messageId: "client:other-1",
      optimistic: true,
      message: { role: "user", text, isOptimistic: true, __openclaw: { id: "client:other-1", clientMessageId: "client:other-1", runId: "run-other" } },
    },
    "chat.message.upsert",
  ),
  sessionKey: "agent:main:test:OTHER-session",
});

describe("applyPatch — cross-session isolation (global patch stream)", () => {
  it("ignores a patch addressed to another session but advances the cursor", () => {
    const start = emptyChatState("agent:main:test:session");
    const res = applyPatch(start, foreignUser("not my message"));
    expect(res.ignored).toBe(true);
    expect(res.needsBootstrap).toBe(false);
    expect(orderedRows(res.state)).toHaveLength(0); // no bleed
    expect(res.state.cursor).toBe(1); // cursor still advanced (no false gap)
  });

  it("keeps only this session's messages when foreign frames are interleaved", () => {
    const s = applyPatches(emptyChatState("agent:main:test:session"), [
      userCreated("mine 1"), // SESSION = agent:main:test:session
      foreignUser("theirs"),
      // another of mine, contiguous cursor after the foreign one
      patch("chat.user.created", {
        runId: "run-2", clientMessageId: "client:mine-2", idempotencyKey: "mine-2", messageId: "client:mine-2",
        optimistic: true,
        message: { role: "user", text: "mine 2", isOptimistic: true, __openclaw: { id: "client:mine-2", clientMessageId: "client:mine-2", runId: "run-2" } },
      }, "chat.message.upsert"),
    ]).state;
    const texts = orderedRows(s).map((r) => r.text);
    expect(texts).toEqual(["mine 1", "mine 2"]);
  });
});
