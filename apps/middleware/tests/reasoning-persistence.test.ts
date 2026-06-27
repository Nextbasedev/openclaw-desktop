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
    databasePath: path.join(os.tmpdir(), `openclaw-v2-reasoning-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function thinkingTextOf(message: unknown): string {
  const data = (message as { data?: { content?: unknown } } | undefined)?.data
    ?? (message as { content?: unknown });
  const content = (data as { content?: unknown })?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "thinking")
    .map((block) => {
      const record = block as { text?: unknown; content?: unknown };
      return typeof record.text === "string" ? record.text : typeof record.content === "string" ? record.content : "";
    })
    .join("");
}

async function setup(name: string) {
  const app = await createApp(config(name));
  const context = contextOf(app);
  let listener: (event: GatewayEvent) => void = () => undefined;
  vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
    listener = cb;
    return () => true;
  });
  vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });
  context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
  await context.chatLive.ensureSessionSubscribed("s1");
  return { app, context, emit: (event: GatewayEvent) => listener(event) };
}

function thinkingEvent(value: { text?: string; delta?: string }): GatewayEvent {
  return {
    type: "event",
    event: "agent",
    stream: "thinking",
    runId: "run-1",
    payload: { sessionKey: "s1", runId: "run-1", stream: "thinking", data: value },
  } as unknown as GatewayEvent;
}

describe("reasoning persistence", () => {
  test("persists accumulated reasoning onto the live assistant message (durable, alongside broadcast)", async () => {
    const { app, context, emit } = await setup("durable");

    emit(thinkingEvent({ delta: "Let me " }));
    emit(thinkingEvent({ delta: "think about it." }));

    // Durable: the live assistant row now carries the accumulated reasoning as a
    // thinking content block (so a re-bootstrap can restore it).
    const live = context.messages.findMessageById("s1", "live:run-1:assistant");
    expect(live).toBeTruthy();
    expect(thinkingTextOf(live)).toBe("Let me think about it.");

    // Broadcast path preserved: chat.reasoning.delta patches are still emitted.
    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches.some((p: { type: string }) => p.type === "chat.reasoning.delta")).toBe(true);

    await app.close();
  });

  test("reasoning survives a re-bootstrap (session switch) and is still bound to the assistant message", async () => {
    const { app, context, emit } = await setup("rebootstrap");

    emit(thinkingEvent({ text: "Step 1. Consider the inputs." }));
    // Assistant text begins streaming after some reasoning.
    emit({
      type: "event",
      event: "chat",
      payload: { sessionKey: "s1", status: "streaming", text: "Here is the answer" },
    } as unknown as GatewayEvent);

    // Text and reasoning must coexist on the live row.
    const live = context.messages.findMessageById("s1", "live:run-1:assistant");
    expect((live?.data as { text?: string })?.text).toContain("Here is the answer");
    expect(thinkingTextOf(live)).toBe("Step 1. Consider the inputs.");

    // Simulate a session switch: a fresh bootstrap snapshot must still carry the
    // reasoning (the gap was that reasoning lived only in the patch log).
    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    const messages = bootstrap.json().messages as unknown[];
    const assistant = messages.find((m) => (m as { role?: string }).role === "assistant"
      || ((m as { data?: { role?: string } }).data?.role === "assistant"));
    expect(assistant).toBeTruthy();
    expect(thinkingTextOf(assistant)).toBe("Step 1. Consider the inputs.");

    await app.close();
  });

  test("A5: a delta after a mid-stream restart grows from the persisted live row (no truncation)", async () => {
    // Stable DB path shared across two app instances => a faithful restart.
    const cfg = config("restart-truncation");

    async function bootOn() {
      const app = await createApp(cfg);
      const context = contextOf(app);
      let listener: (event: GatewayEvent) => void = () => undefined;
      vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => { listener = cb; return () => true; });
      vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });
      await context.chatLive.ensureSessionSubscribed("s1");
      return { app, context, emit: (event: GatewayEvent) => listener(event) };
    }
    const chatDelta = (delta: string): GatewayEvent => ({
      type: "event", event: "chat",
      payload: { sessionKey: "s1", runId: "run-1", data: { delta } },
    } as unknown as GatewayEvent);
    const liveTextOf = (context: AppContext) =>
      (context.messages.findMessageById("s1", "live:run-1:assistant")?.data as { text?: string })?.text;

    // App #1: stream two deltas into the persisted live row.
    const a = await bootOn();
    a.context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "streaming", statusLabel: "Streaming", startedAtMs: 100, updatedAtMs: 100 });
    a.emit(chatDelta("Hello "));
    a.emit(chatDelta("world"));
    expect(liveTextOf(a.context)).toBe("Hello world"); // happy-path accumulation
    await a.app.close();

    // App #2: SAME db = restart. In-memory accumulator is empty but the
    // persisted live row still holds "Hello world".
    const b = await bootOn();
    expect(b.context.chatLive.diagnostics().liveAssistantRuns).toBe(0); // baseline lost on restart
    b.emit(chatDelta(" again"));
    // Must GROW from the persisted base, not overwrite the row with just the delta.
    expect(liveTextOf(b.context)).toBe("Hello world again");
    // Once seeded, normal in-memory accumulation continues unchanged.
    b.emit(chatDelta(" and more"));
    expect(liveTextOf(b.context)).toBe("Hello world again and more");
    await b.app.close();
  });

  test("A5b: a reasoning delta after a mid-stream restart grows from the persisted thinking block (no truncation)", async () => {
    const cfg = config("restart-reasoning-truncation");

    async function bootOn() {
      const app = await createApp(cfg);
      const context = contextOf(app);
      let listener: (event: GatewayEvent) => void = () => undefined;
      vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => { listener = cb; return () => true; });
      vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });
      await context.chatLive.ensureSessionSubscribed("s1");
      return { app, context, emit: (event: GatewayEvent) => listener(event) };
    }
    const reasoningDeltaOf = (context: AppContext) =>
      thinkingTextOf(context.messages.findMessageById("s1", "live:run-1:assistant"));

    // App #1: stream two reasoning deltas into the persisted thinking block.
    const a = await bootOn();
    a.context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
    a.emit(thinkingEvent({ delta: "Let me " }));
    a.emit(thinkingEvent({ delta: "reason" }));
    expect(reasoningDeltaOf(a.context)).toBe("Let me reason"); // happy-path accumulation
    await a.app.close();

    // App #2: SAME db = restart. In-memory reasoning accumulator empty, but the
    // persisted thinking block still holds "Let me reason".
    const b = await bootOn();
    expect(b.context.chatLive.diagnostics().liveReasoningRuns).toBe(0); // baseline lost on restart
    b.emit(thinkingEvent({ delta: " carefully" }));
    expect(reasoningDeltaOf(b.context)).toBe("Let me reason carefully"); // grew, not truncated
    b.emit(thinkingEvent({ delta: " now" }));
    expect(reasoningDeltaOf(b.context)).toBe("Let me reason carefully now"); // in-memory continues
    await b.app.close();
  });

  test("reasoning accumulation is cleared once the run is finalized", async () => {
    const { app, context, emit } = await setup("cleanup");
    emit(thinkingEvent({ delta: "thinking..." }));
    expect(context.chatLive.diagnostics().liveReasoningRuns ?? 0).toBeGreaterThan(0);

    emit({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 2,
        message: { role: "assistant", text: "final", __openclaw: { id: "assistant-final", seq: 2, runId: "run-1" } },
      },
    } as unknown as GatewayEvent);

    expect(context.runs.getRun("run-1")).toMatchObject({ status: "done" });
    expect(context.chatLive.diagnostics().liveReasoningRuns ?? 0).toBe(0);

    await app.close();
  });
});
