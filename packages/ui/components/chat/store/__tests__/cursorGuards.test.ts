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

  it("flags re-bootstrap on a cursor gap", () => {
    const r1 = applyPatch(base(), userCreated("hi"));
    const future: ChatPatch = { ...assistantDelta("yo"), cursor: r1.state.cursor + 5 };
    const r2 = applyPatch(r1.state, future);
    expect(r2.needsBootstrap).toBe(true);
    expect(r2.state).toBe(r1.state);
  });
});
