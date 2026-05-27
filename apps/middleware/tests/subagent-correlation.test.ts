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

describe("subagent session extraction", () => {
  test("extracts subagent keys from text and nested JSON strings", () => {
    expect(extractSubagentSessionKey("linked agent:main:desktop:subagent:child-1 ok")).toBe("agent:main:desktop:subagent:child-1");
    expect(extractSubagentSessionKey({ result: '{"childSessionKey":"agent:main:desktop:subagent:child-2"}' })).toBe("agent:main:desktop:subagent:child-2");
  });
});
