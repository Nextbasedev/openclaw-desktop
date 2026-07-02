import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { GatewayEvent } from "../src/features/gateway/client.js";
import type { MiddlewareConfig } from "../src/config/env.js";

// End-to-end coverage for the intermittent stuck "Writing..." bug.
//
// Field symptom: the full assistant reply is rendered, but the spinner never
// clears. Root cause (apps/middleware live.ts handleSessionMessage): when the
// final assistant message is a replay/dedup no-op (upsertMessages -> upserted 0,
// e.g. the canonical row already persisted before a gateway reconnect and the
// run's terminal was lost during the disconnect), the handler returned EARLY,
// before the run-finalization + terminal broadcast. So the run stayed pending
// forever and no chat.run.done / chat.assistant.final ever reached the client.
//
// These tests drive the REAL middleware pipeline (createApp + real sqlite + real
// gateway event projection) and assert the client-facing terminal patch is now
// emitted, while proving the normal / tool-running flows are unchanged.

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-stuck-writing-${name}-${Date.now()}-${Math.random()}.sqlite`),
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

async function patchesAfter(app: Awaited<ReturnType<typeof createApp>>, cursor: number) {
  const res = await app.inject({ method: "GET", url: `/api/patches?afterCursor=${cursor}` });
  expect(res.statusCode).toBe(200);
  return res.json().patches as Array<{ type: string; cursor: number; payload: Record<string, unknown> }>;
}

const finalMessage = (id: string, text: string, seq: number, runId?: string) => ({
  type: "event" as const,
  event: "session.message",
  payload: {
    sessionKey: "s1",
    messageSeq: seq,
    message: {
      role: "assistant",
      text,
      provider: "openai-codex",
      stopReason: "stop",
      __openclaw: { id, seq, ...(runId ? { runId } : {}) },
    },
  },
});

describe("stuck Writing: replayed assistant final settles the run", () => {
  test("CASE-DUP-FINAL: deduped replay of an uncorrelated final finalizes the (still-pending) run + broadcasts chat.run.done", async () => {
    const { app, context, emit } = await harness("dup-final");

    // FIRST delivery: the final arrives (with a runId) BEFORE the run record
    // exists/correlates -> associatedRun is null -> the row is persisted but the
    // run-finalization block is skipped. This is the real ordering that leaves a
    // pending run with a persisted final (out-of-order events across a reconnect).
    emit(finalMessage("assistant-final", "Here is your answer.", 2, "run-1"));
    expect(context.messages.findMessageById("s1", "assistant-final")).toMatchObject({ role: "assistant" });

    // The run record now appears, still pending (its terminal never fired).
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "thinking" });

    const cursorBeforeReplay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" })
      .then((r) => (r.json().patches as Array<{ cursor: number }>).reduce((m, p) => Math.max(m, p.cursor), 0));

    // Gateway reconnect replays the SAME final -> upsertMessages dedup no-op
    // (upserted === 0) -> the early-return path.
    emit(finalMessage("assistant-final", "Here is your answer.", 2, "run-1"));

    // FIX: even on the deduped replay, the still-pending run is finalized and an
    // explicit terminal is broadcast. Pre-fix this returned early -> stuck.
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "done", statusLabel: null });

    const newPatches = await patchesAfter(app, cursorBeforeReplay);
    const terminal = newPatches.find(
      (p) => p.type === "chat.status" && p.payload.status === "done" && p.payload.semanticType === "chat.run.done",
    );
    expect(terminal, "a chat.run.done terminal must be broadcast on the deduped replay").toBeTruthy();
    expect(terminal?.payload).toMatchObject({ runId: "run-1", status: "done" });

    await app.close();
  });

  test("CASE-DUP-FINAL-NO-RUNID: deduped replay of a runId-less final settles via oldest pending run", async () => {
    const { app, context, emit } = await harness("dup-final-no-runid");

    // First delivery: runId-less final, no pending run yet -> associatedRun null,
    // row persisted, no finalization.
    emit(finalMessage("assistant-final", "Reply body.", 2));
    expect(context.messages.findMessageById("s1", "assistant-final")).toMatchObject({ role: "assistant" });

    // Pending run appears afterwards.
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "streaming", statusLabel: "Streaming", startedAtMs: 100, updatedAtMs: 100 });

    const cursorBefore = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" })
      .then((r) => (r.json().patches as Array<{ cursor: number }>).reduce((m, p) => Math.max(m, p.cursor), 0));

    // Replay -> dedup no-op -> fix must resolve run via findOldestPendingRun.
    emit(finalMessage("assistant-final", "Reply body.", 2));

    expect(context.runs.getRun("run-1")).toMatchObject({ status: "done" });
    const terminal = (await patchesAfter(app, cursorBefore)).find(
      (p) => p.type === "chat.status" && p.payload.status === "done",
    );
    expect(terminal, "runId-less replay must still settle via findOldestPendingRun").toBeTruthy();

    await app.close();
  });

  test("REGRESSION CASE-NORMAL: a single final still settles exactly once (no premature/duplicate terminal)", async () => {
    const { app, context, emit } = await harness("normal-final");

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
    emit({ type: "event", event: "chat", payload: { sessionKey: "s1", status: "streaming", text: "Hi" } });
    emit(finalMessage("assistant-final", "Hi there, all done.", 2, "run-1"));

    expect(context.runs.getRun("run-1")).toMatchObject({ status: "done", statusLabel: null });
    const patches = await patchesAfter(app, 0);
    const finalMsg = patches.find(
      (p) => p.type === "chat.message.upsert" && p.payload.semanticType === "chat.assistant.final",
    );
    expect(finalMsg?.payload).toMatchObject({ runId: "run-1", runStatus: "done", activeRun: null });
    await app.close();
  });

  test("REGRESSION CASE-TOOL-RUNNING: run is NOT finalized while a tool is still running", async () => {
    const { app, context, emit } = await harness("tool-running");

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "tool_running", statusLabel: "Running tool", startedAtMs: 100, updatedAtMs: 100 });
    // Register an in-flight tool call on the run.
    context.runs.upsertToolCall({
      runId: "run-1",
      sessionKey: "s1",
      toolCallId: "tool-1",
      name: "search",
      phase: "calling",
      status: "running",
      startedAtMs: 110,
      updatedAtMs: 110,
    });
    expect(context.runs.hasRunningTools("s1", "run-1")).toBe(true);

    // An interim assistant message arrives while the tool is still running.
    emit(finalMessage("assistant-interim", "Working on it...", 2, "run-1"));

    // Must stay active (guard: !hasRunningTools). Spinner must NOT clear yet.
    expect(context.runs.getRun("run-1")?.status).not.toBe("done");
    await app.close();
  });
});
