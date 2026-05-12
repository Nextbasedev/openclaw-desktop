import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { GatewayEvent } from "../src/features/gateway/client.js";
import type { MiddlewareV2Config } from "../src/config/env.js";

function config(name: string): MiddlewareV2Config {
  return {
    host: "127.0.0.1",
    port: 8989,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-live-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

describe("patch replay", () => {
  test("/api/patches replays projection events after cursor", async () => {
    const app = await createApp(config("patches"));
    const anyApp = app as any;
    const context = anyApp.initialConfig ? null : null;
    // Use public route behavior by appending directly through exposed app context is intentionally avoided here.
    // This test validates the route contract via an empty replay first.
    const res = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, count: 0 });
    void context;
    await app.close();
  });
});

describe("chat live ingest", () => {
  test("assistant final without a run id completes the pending run and canonical bootstrap", async () => {
    const app = await createApp(config("assistant-final-pending-run"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "sessions.messages.subscribe") return { ok: true };
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          messages: [
            { role: "assistant", text: "NO_REPLY", provider: "openai-codex", stopReason: "stop", __openclaw: { id: "assistant-1", seq: 2 } },
          ],
        };
      }
      return { ok: true };
    });

    context.runs.upsertRun({ runId: "run-pending", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
    context.messages.upsertSession({ sessionKey: "s1", sessionId: "session-1", data: { sessionKey: "s1", sessionId: "session-1", status: "running", statusLabel: "Thinking" }, updatedAtMs: 100 });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 2,
        message: {
          role: "assistant",
          text: "NO_REPLY",
          provider: "openai-codex",
          model: "gpt-5.5",
          stopReason: "stop",
          __openclaw: { id: "assistant-1", seq: 2 },
        },
      },
    });

    expect(context.messages.listMessages("s1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", messageId: "assistant-1" }),
    ]));
    expect(context.runs.getRun("run-pending")).toMatchObject({ status: "done", statusLabel: null });
    expect(context.runs.findLatestPendingRun("s1")).toBeNull();
    expect(context.messages.getSession("s1")?.data).toMatchObject({ status: "done", statusLabel: null });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          semanticType: "chat.assistant.final",
          runId: "run-pending",
          runStatus: "done",
          activeRun: null,
          statusLabel: null,
          messageSeq: 2,
        }),
      }),
    ]));

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "done",
      activeRun: null,
      statusLabel: null,
      messages: [expect.objectContaining({ role: "assistant", text: "NO_REPLY" })],
    });
    await app.close();
  });

  test("does not match the only pending optimistic user to a stale live user echo with different text", async () => {
    const app = await createApp(config("stale-live-user-no-confirm"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.chatLive.addOptimisticUser("s1", { id: "client-1", text: "good night now", createdAtMs: Date.now() });
    context.messages.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "good night now", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1" } },
      updatedAtMs: Date.now(),
    });
    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 1,
        message: {
          role: "user",
          text: "byy",
          __openclaw: { id: "gateway-stale", seq: 1 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.confirmed",
        payload: expect.objectContaining({ optimisticId: "client-1" }),
      }),
    ]));
    expect(context.messages.listMessages("s1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageId: "client-1", role: "user", data: expect.objectContaining({ text: "good night now" }) }),
      expect.objectContaining({ messageId: "gateway-stale", role: "user", data: expect.objectContaining({ text: "byy" }) }),
    ]));
    await app.close();
  });

  test("confirms optimistic user echoes from content blocks and uses positive fallback seq", async () => {
    const app = await createApp(config("content-optimistic-confirm"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.chatLive.addOptimisticUser("s1", { id: "client-1", text: "hello world", createdAtMs: Date.now() });
    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 0,
        message: {
          role: "user",
          content: [{ type: "text", text: "Sender (untrusted metadata):\n```json\n{}\n```\n\n[Sun 2026-05-10 17:03 UTC] hello world\n\n[Bootstrap truncation warning]\nignored" }],
          __openclaw: { id: "gateway-1", seq: 0 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.confirmed",
        payload: expect.objectContaining({
          optimisticId: "client-1",
          messageSeq: 1,
        }),
      }),
    ]));
    await app.close();
  });

  test("persists gateway session.tool events with nested data payloads", async () => {
    const app = await createApp(config("nested-session-tool"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", gatewayRunId: "gw-run-1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.tool",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        data: {
          phase: "start",
          toolCallId: "tool-1",
          name: "session_status",
          args: { model: "default" },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({
      toolCallId: "tool-1",
      name: "session_status",
      status: "running",
      runId: "run-1",
    });
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "tool_running", statusLabel: "session_status" });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.started",
        payload: expect.objectContaining({
          toolCallId: "tool-1",
          runStatus: "tool_running",
          statusLabel: "session_status",
        }),
      }),
    ]));
    await app.close();
  });

  test("derives tool activity from assistant tool-call blocks when session.tool is absent", async () => {
    const app = await createApp(config("message-tool-blocks"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 2,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "read", input: { path: "README.md" } }],
          __openclaw: { id: "assistant-tools", seq: 2 },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({
      toolCallId: "tool-1",
      name: "read",
      status: "running",
      runId: "run-1",
      messageId: "assistant-tools",
    });
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "tool_running", statusLabel: "read" });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.json()).toMatchObject({
      runStatus: "tool_running",
      activeRun: expect.objectContaining({ runId: "run-1" }),
      toolCalls: [expect.objectContaining({ toolCallId: "tool-1", name: "read", status: "running" })],
    });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 3,
        message: {
          role: "assistant",
          text: "Done — I read the file.",
          __openclaw: { id: "assistant-final", seq: 3 },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({ status: "success", phase: "result" });
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "done", statusLabel: null });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 2,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-1", name: "read", input: { path: "README.md" } }],
          __openclaw: { id: "assistant-tools-replayed", seq: 2 },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({ status: "success", phase: "result" });
    const finalBootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(finalBootstrap.json()).toMatchObject({
      runStatus: "done",
      activeRun: null,
      toolCalls: [expect.objectContaining({ toolCallId: "tool-1", name: "read", status: "success" })],
    });
    await app.close();
  });

});
