import { beforeEach, describe, expect, it, vi } from "vitest";
import { createChatStore } from "../store";
import { orderedRows } from "../selectors";
import { SESSION, assistantDelta, patch, resetCursor, runStatus, userCreated } from "./fixtures";
import { snapshot } from "../../sync/__tests__/fakeSocket";
import type { ChatPatch } from "../../sync/types.contract";

beforeEach(() => resetCursor());

function manualStore(onNeedBootstrap?: () => void) {
  let flush: (() => void) | null = null;
  const store = createChatStore(SESSION, {
    schedule: (fn) => { flush = fn; return () => { flush = null; }; },
    onNeedBootstrap,
  });
  return { store, fire: () => flush?.() };
}

describe("createChatStore — RAF batching", () => {
  it("coalesces multiple queued patches into a single commit", () => {
    const { store, fire } = manualStore();
    let emits = 0;
    store.subscribe(() => { emits += 1; });
    store.enqueuePatch(userCreated("hi"));
    store.enqueuePatch(runStatus("thinking", "Thinking"));
    store.enqueuePatch(assistantDelta("yo"));
    expect(emits).toBe(0); // nothing applied until flush
    fire();
    expect(emits).toBe(1); // one commit for the whole batch
    expect(orderedRows(store.getState()).length).toBeGreaterThan(0);
  });

  it("bootstrap resets state and clears the queue", () => {
    const { store, fire } = manualStore();
    store.enqueuePatch(userCreated("stale"));
    store.bootstrap(snapshot(200));
    expect(store.getState().cursor).toBe(200);
    fire(); // queued stale patch was dropped by bootstrap
    expect(orderedRows(store.getState())).toHaveLength(0);
  });

  it("calls onNeedBootstrap on a cursor gap", () => {
    const onNeed = vi.fn();
    const { store, fire } = manualStore(onNeed);
    store.bootstrap(snapshot(10));
    const future: ChatPatch = { ...patch("chat.status", { runId: "r", runStatus: "thinking", status: "thinking" }), cursor: 99 };
    store.enqueuePatch(future);
    fire();
    expect(onNeed).toHaveBeenCalledOnce();
  });

  it("subscribe/unsubscribe controls notifications", () => {
    const { store, fire } = manualStore();
    let n = 0;
    const off = store.subscribe(() => { n += 1; });
    store.enqueuePatch(userCreated("a")); fire();
    expect(n).toBe(1);
    off();
    store.enqueuePatch(runStatus("thinking", "Thinking")); fire();
    expect(n).toBe(1);
  });
});
