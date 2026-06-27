import { describe, expect, test } from "vitest";
import { SubagentCorrelation } from "../src/features/chat/subagent-correlation.js";
import { extractSubagentSessionKey } from "../src/features/chat/subagent-session.js";

describe("subagent correlation", () => {
  test("links a discovered child to the only pending spawn", () => {
    const correlation = new SubagentCorrelation();
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1000 });

    const link = correlation.discoverChild("agent:main:desktop:subagent:child-1", 1100);

    expect(link).toMatchObject({
      parentSessionKey: "parent-1",
      toolCallId: "spawn-1",
      childSessionKey: "agent:main:desktop:subagent:child-1",
    });
    expect(correlation.discoverChild("agent:main:desktop:subagent:child-1", 1200)).toBeNull();
  });

  test("does not guess when multiple pending spawns are eligible", () => {
    const correlation = new SubagentCorrelation();
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1000 });
    correlation.registerSpawn({ parentSessionKey: "parent-2", toolCallId: "spawn-2", nowMs: 1000 });

    expect(correlation.discoverChild("agent:main:desktop:subagent:child-1", 1100)).toBeNull();
  });

  test("links a child discovered before the spawn when it is unambiguous", () => {
    const correlation = new SubagentCorrelation();
    expect(correlation.discoverChild("agent:main:desktop:subagent:child-1", 1000)).toBeNull();

    const { link } = correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1100 });

    expect(link).toMatchObject({
      parentSessionKey: "parent-1",
      toolCallId: "spawn-1",
      childSessionKey: "agent:main:desktop:subagent:child-1",
    });
  });
});

describe("subagent correlation — restart rehydrate, concurrency, sweep", () => {
  const child1 = "agent:main:desktop:subagent:child-1";
  const child2 = "agent:main:desktop:subagent:child-2";

  test("rehydrate restores a linked spawn so child activity links after a fresh instance (restart)", () => {
    // Simulate a middleware restart: a brand-new correlation has no in-memory
    // state. Before this fix, the link was lost and child activity went
    // unlinked. Rehydrating from persisted sessions_spawn rows restores it.
    const restarted = new SubagentCorrelation();
    expect(restarted.linkedSpawnForChild(child1)).toBeNull();

    const result = restarted.rehydrate([
      { parentSessionKey: "parent-1", toolCallId: "spawn-1", childSessionKey: child1, createdAtMs: 1000 },
    ]);
    expect(result).toMatchObject({ linked: 1, pending: 0 });

    expect(restarted.linkedSpawnForChild(child1)).toMatchObject({
      parentSessionKey: "parent-1",
      toolCallId: "spawn-1",
      childSessionKey: child1,
    });
    // Re-discovering the same child must not double-link.
    expect(restarted.discoverChild(child1, 1100)).toBeNull();
  });

  test("rehydrate restores an unlinked pending spawn that links on the next child discovery", () => {
    const restarted = new SubagentCorrelation();
    restarted.rehydrate([{ parentSessionKey: "parent-1", toolCallId: "spawn-1", createdAtMs: 1000 }]);
    const link = restarted.discoverChild(child1, 1100);
    expect(link).toMatchObject({ toolCallId: "spawn-1", childSessionKey: child1 });
  });

  test("concurrent multi-spawn: ambiguous discovery defers, explicit linkSpecific links each to the correct child", () => {
    const correlation = new SubagentCorrelation();
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1000 });
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-2", nowMs: 1000 });

    // Two unlinked spawns => discovery cannot guess.
    expect(correlation.discoverChild(child1, 1100)).toBeNull();
    expect(correlation.discoverChild(child2, 1100)).toBeNull();

    // sessions_spawn results carry the childSessionKey => explicit links resolve.
    const l1 = correlation.linkSpecific("spawn-1", child1, 1200);
    const l2 = correlation.linkSpecific("spawn-2", child2, 1200);
    expect(l1).toMatchObject({ toolCallId: "spawn-1", childSessionKey: child1 });
    expect(l2).toMatchObject({ toolCallId: "spawn-2", childSessionKey: child2 });
    expect(correlation.linkedSpawnForChild(child1)?.toolCallId).toBe("spawn-1");
    expect(correlation.linkedSpawnForChild(child2)?.toolCallId).toBe("spawn-2");
  });

  test("sweep empties linked maps after the linked TTL (no process-lifetime retention)", () => {
    const correlation = new SubagentCorrelation(5 * 60 * 1000, 10 * 60 * 1000);
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1000 });
    correlation.linkSpecific("spawn-1", child1, 1000);
    expect(correlation.stats()).toMatchObject({ pendingSpawns: 1, linkedChildren: 1 });

    // A sweep well past the linked TTL drops the linked entry too.
    correlation.discoverChild("agent:main:desktop:subagent:unrelated", 1000 + 11 * 60 * 1000);
    const stats = correlation.stats();
    expect(stats.linkedChildren).toBe(0);
    expect(stats.pendingSpawns).toBe(0);
    expect(correlation.linkedSpawnForChild(child1)).toBeNull();
  });

  test("release(child) removes the link immediately (e.g. on subagent completion)", () => {
    const correlation = new SubagentCorrelation();
    correlation.registerSpawn({ parentSessionKey: "parent-1", toolCallId: "spawn-1", nowMs: 1000 });
    correlation.linkSpecific("spawn-1", child1, 1000);
    expect(correlation.stats()).toMatchObject({ linkedChildren: 1 });

    correlation.release(child1);
    expect(correlation.linkedSpawnForChild(child1)).toBeNull();
    expect(correlation.stats()).toMatchObject({ linkedChildren: 0, pendingSpawns: 0 });
  });
});

describe("subagent session extraction", () => {
  test("extracts subagent keys from text and nested JSON strings", () => {
    expect(extractSubagentSessionKey("linked agent:main:desktop:subagent:child-1 ok")).toBe("agent:main:desktop:subagent:child-1");
    expect(extractSubagentSessionKey({ result: '{"childSessionKey":"agent:main:desktop:subagent:child-2"}' })).toBe("agent:main:desktop:subagent:child-2");
  });
});
