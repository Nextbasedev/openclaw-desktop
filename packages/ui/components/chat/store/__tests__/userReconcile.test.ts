import { beforeEach, describe, expect, it } from "vitest";
import { applyPatch } from "../applyPatch";
import { userKey } from "../state";
import { CANONICAL_USER_ID, CLIENT_ID, resetCursor, userConfirmed, userCreated } from "./fixtures";
import { base } from "./helpers";

beforeEach(() => resetCursor());

describe("applyPatch — user optimistic -> confirmed (no remount)", () => {
  it("keeps the same row key across created -> confirmed", () => {
    const created = applyPatch(base(), userCreated("hello world")).state;
    expect(created.rows.size).toBe(1);
    const optimistic = [...created.rows.values()][0];
    expect(optimistic.key).toBe(userKey(CLIENT_ID));
    expect(optimistic.isOptimistic).toBe(true);
    expect(optimistic.messageId).toBeNull();

    const confirmed = applyPatch(created, userConfirmed("hello world", 1)).state;
    expect(confirmed.rows.size).toBe(1); // no duplicate
    const row = confirmed.rows.get(userKey(CLIENT_ID))!;
    expect(row.key).toBe(userKey(CLIENT_ID)); // SAME key
    expect(row.messageId).toBe(CANONICAL_USER_ID);
    expect(row.isOptimistic).toBe(false);
    expect(row.finalized).toBe(true);
    expect(row.seq).toBe(1);
    expect(confirmed.byMessageId.get(CANONICAL_USER_ID)).toBe(userKey(CLIENT_ID));
  });
});
