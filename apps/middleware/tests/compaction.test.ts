import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { GatewayEvent } from "../src/features/gateway/client.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-compaction-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

async function harness(name: string) {
  const app = await createApp(config(name));
  const context = contextOf(app);
  let listener: (event: GatewayEvent) => void = () => undefined;
  vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
    listener = cb;
    return () => true;
  });
  vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });
  await context.chatLive.ensureSessionSubscribed("s1");
  return { app, context, emit: (event: GatewayEvent) => listener(event) };
}

async function replayPatches(app: Awaited<ReturnType<typeof createApp>>) {
  const res = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
  expect(res.statusCode).toBe(200);
  return res.json().patches as Array<{ type: string; payload: Record<string, unknown> }>;
}

describe("compaction events", () => {
  test("live agent compaction stream broadcasts start/end status patches without ending the run", async () => {
    const { app, context, emit } = await harness("live-status");
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "tool_running", statusLabel: "Running", startedAtMs: 100, updatedAtMs: 100 });

    emit({
      type: "event",
      event: "agent",
      payload: { sessionKey: "s1", runId: "run-1", stream: "compaction", data: { phase: "start" } },
    });
    emit({
      type: "event",
      event: "agent",
      payload: { sessionKey: "s1", runId: "run-1", stream: "compaction", data: { phase: "end", completed: true } },
    });

    const patches = await replayPatches(app);
    const statusPatches = patches.filter((p) => p.type === "chat.compaction.status");
    expect(statusPatches).toHaveLength(2);
    expect(statusPatches[0].payload).toMatchObject({ runId: "run-1", phase: "start", active: true });
    expect(statusPatches[1].payload).toMatchObject({ runId: "run-1", phase: "end", active: false, completed: true });
    // Compaction must not terminate an in-flight run.
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "tool_running" });
    await app.close();
  });

  test("session.compaction event persists a marker patch with the OCPlatform summary", async () => {
    const { app, emit } = await harness("marker");
    emit({
      type: "event",
      event: "session.compaction",
      payload: {
        sessionKey: "s1",
        id: "cmp-1",
        summary: "## Goal\nDo the thing\n## Progress\n- [x] step",
        firstKeptEntryId: "keep-1",
        tokensBefore: 123456,
        details: { attempt: 1 },
        fromHook: false,
      },
    });

    const patches = await replayPatches(app);
    const markers = patches.filter((p) => p.type === "chat.compaction.marker");
    expect(markers).toHaveLength(1);
    expect(markers[0].payload).toMatchObject({
      compactionId: "cmp-1",
      summary: "## Goal\nDo the thing\n## Progress\n- [x] step",
      firstKeptEntryId: "keep-1",
      tokensBefore: 123456,
      fromHook: false,
    });
    await app.close();
  });

  test("marker carries a stable compactionId derived from firstKeptEntryId when no explicit id", async () => {
    const { app, emit } = await harness("marker-derived-id");
    emit({
      type: "event",
      event: "session.compaction",
      payload: { sessionKey: "s1", summary: "x", firstKeptEntryId: "keep-9" },
    });
    const markers = (await replayPatches(app)).filter((p) => p.type === "chat.compaction.marker");
    expect(markers).toHaveLength(1);
    expect(markers[0].payload.compactionId).toBe("keep-9");
    await app.close();
  });
});
