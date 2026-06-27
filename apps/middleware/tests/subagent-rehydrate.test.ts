import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-subagent-rehydrate-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

const CHILD = "agent:main:desktop:subagent:child-1";

describe("sub-agent correlation rehydrate on startup", () => {
  test("listCreateTaskToolCalls returns only sessions_spawn rows with their result meta", async () => {
    const app = await createApp(config("repo"));
    const context = contextOf(app);
    context.runs.upsertToolCall({
      toolCallId: "spawn-1", sessionKey: "parent-1", name: "sessions_spawn", phase: "result", status: "success",
      resultMeta: { childSessionKey: CHILD }, startedAtMs: 1000,
    });
    context.runs.upsertToolCall({
      toolCallId: "other-1", sessionKey: "parent-1", name: "web_fetch", phase: "result", status: "success", startedAtMs: 1001,
    });

    const rows = context.runs.listCreateTaskToolCalls();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionKey: "parent-1", toolCallId: "spawn-1" });
    expect(rows[0].resultMetaJson).toContain(CHILD);
    await app.close();
  });

  test("rehydrate links a persisted sessions_spawn spawn whose result carries the child key", async () => {
    const app = await createApp(config("linked"));
    const context = contextOf(app);
    context.runs.upsertToolCall({
      toolCallId: "spawn-1", sessionKey: "parent-1", name: "sessions_spawn", phase: "result", status: "success",
      resultMeta: { childSessionKey: CHILD }, startedAtMs: 1000,
    });

    const result = context.chatLive.rehydrateSubagentCorrelation();
    expect(result).toMatchObject({ spawns: 1, linked: 1, pending: 0 });
    await app.close();
  });

  test("rehydrate restores an unlinked spawn (no child key yet) as pending", async () => {
    const app = await createApp(config("pending"));
    const context = contextOf(app);
    context.runs.upsertToolCall({
      toolCallId: "spawn-1", sessionKey: "parent-1", name: "sessions_spawn", phase: "start", status: "running", startedAtMs: 1000,
    });

    const result = context.chatLive.rehydrateSubagentCorrelation();
    expect(result).toMatchObject({ spawns: 1, linked: 0, pending: 1 });
    await app.close();
  });

  test("rehydrate fires automatically on app startup (real boot path, not a direct call)", async () => {
    // Reuse one DB file across two app instances: the first persists a linked
    // sessions_spawn row, the second boots against it. The second app's correlation
    // must already be hydrated WITHOUT anyone calling rehydrate directly —
    // proving createApp() wires it into the boot path (6-criteria #5).
    const cfg = config("boot");
    const seed = await createApp(cfg);
    contextOf(seed).runs.upsertToolCall({
      toolCallId: "spawn-1", sessionKey: "parent-1", name: "sessions_spawn", phase: "result", status: "success",
      resultMeta: { childSessionKey: CHILD }, startedAtMs: 1000,
    });
    await seed.close();

    const booted = await createApp(cfg);
    // No direct rehydrate call here — if startup wiring is missing this is 0.
    expect(contextOf(booted).chatLive.subagentStats()).toMatchObject({ linkedChildren: 1, pendingSpawns: 1 });
    await booted.close();
  });
});
