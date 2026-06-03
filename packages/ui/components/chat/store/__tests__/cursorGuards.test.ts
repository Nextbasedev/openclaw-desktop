import { beforeEach, describe, expect, it } from "vitest";
import { applyPatch } from "../applyPatch";
import { assistantDelta, resetCursor, userCreated } from "./fixtures";
import { base } from "./helpers";
import type { ChatPatch } from "../../sync/types.contract";

beforeEach(() => resetCursor());

describe("applyPatch — cursor guards", () => {
  it("ignores duplicate / already-applied cursors", () => {
    const p = userCreated("hi");
    const r1 = applyPatch(base(), p);
    expect(r1.ignored).toBe(false);
    const r2 = applyPatch(r1.state, { ...p, cursor: p.cursor });
    expect(r2.ignored).toBe(true);
    expect(r2.state).toBe(r1.state);
  });

  it("APPLIES a forward cursor jump (gap recovery is ChatSyncClient's job, not the store's)", () => {
    // The store consumes a session-filtered substream of a global cursor, so a
    // forward jump is normal (other sessions advanced the cursor). It must apply,
    // not re-bootstrap — that's what kept the parent alive while a subagent ran.
    const r1 = applyPatch(base(), userCreated("hi"));
    const future: ChatPatch = { ...assistantDelta("yo"), cursor: r1.state.cursor + 5 };
    const r2 = applyPatch(r1.state, future);
    expect(r2.needsBootstrap).toBe(false);
    expect(r2.ignored).toBe(false);
    expect(r2.state.cursor).toBe(future.cursor);
  });
});
