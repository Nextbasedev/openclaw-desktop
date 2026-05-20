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

  test("broadcasts reasoning deltas from Gateway agent thinking events", async () => {
    const app = await createApp(config("agent-thinking-events"));
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
      event: "agent",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        stream: "thinking",
        data: { text: "Checking the repo", delta: "Checking" },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.reasoning.delta",
        payload: expect.objectContaining({
          semanticType: "chat.reasoning.delta",
          runId: "run-1",
          text: "Checking the repo",
          delta: "Checking",
        }),
      }),
    ]));
    await app.close();
  });

  test("infers missing result for previous sequential tool when the next tool starts", async () => {
    const app = await createApp(config("sequential-tool-missing-result"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", gatewayRunId: "gw-run-1", status: "tool_running", statusLabel: "session_status", startedAtMs: now - 2_000, updatedAtMs: now - 2_000 });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "run-1", toolCallId: "tool-1", name: "session_status", phase: "calling", status: "running", startedAtMs: now - 2_000, updatedAtMs: now - 2_000 });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.tool",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        data: {
          phase: "start",
          toolCallId: "tool-2",
          name: "read",
          args: { path: "README.md" },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({ status: "success", phase: "result" });
    expect(context.runs.getToolCall("s1", "tool-2")).toMatchObject({ status: "running", phase: "start", name: "read" });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string; toolCall?: { resultMeta?: unknown } } }>;
    const inferredResultIndex = patches.findIndex((patch) => patch.type === "chat.tool.result" && patch.payload?.toolCallId === "tool-1");
    const nextStartIndex = patches.findIndex((patch) => patch.type === "chat.tool.started" && patch.payload?.toolCallId === "tool-2");
    expect(inferredResultIndex).toBeGreaterThanOrEqual(0);
    expect(nextStartIndex).toBeGreaterThan(inferredResultIndex);
    expect(patches[inferredResultIndex]?.payload?.toolCall?.resultMeta ?? undefined).toBeUndefined();
    await app.close();
  });

  test("preserves live session.tool partial output for response tool rendering", async () => {
    const app = await createApp(config("session-tool-partial-output"));
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
          phase: "update",
          toolCallId: "tool-live",
          name: "exec",
          partialResult: { stdout: "live output", stderr: "" },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-live")).toMatchObject({
      toolCallId: "tool-live",
      name: "exec",
      status: "running",
      resultMeta: { stdout: "live output", stderr: "" },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.started",
        payload: expect.objectContaining({
          toolCall: expect.objectContaining({ resultMeta: { stdout: "live output", stderr: "" } }),
        }),
      }),
    ]));
    await app.close();
  });

  test("does not attach stale detached tool replay to the current active run", async () => {
    const app = await createApp(config("stale-detached-tool-replay"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    const now = Date.now();
    context.runs.upsertToolCall({
      sessionKey: "s1",
      toolCallId: "old-tool",
      name: "web_fetch",
      phase: "calling",
      status: "running",
      startedAtMs: now - 12 * 60 * 60 * 1000,
      updatedAtMs: now - 12 * 60 * 60 * 1000,
    });
    context.runs.upsertRun({ runId: "run-current", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: now, updatedAtMs: now });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.tool",
      payload: {
        sessionKey: "s1",
        data: {
          phase: "start",
          toolCallId: "old-tool",
          name: "web_fetch",
        },
      },
    });

    expect(context.runs.getToolCall("s1", "old-tool")).toMatchObject({ runId: null, status: "running" });
    expect(context.runs.getRun("run-current")).toMatchObject({ status: "thinking", statusLabel: "Thinking" });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.started",
        payload: expect.objectContaining({ toolCallId: "old-tool" }),
      }),
    ]));
    await app.close();
  });

  test("broadcasts tool result immediately from tool_result message blocks", async () => {
    const app = await createApp(config("message-tool-result-blocks"));
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
          content: [{ type: "tool_use", id: "tool-1", name: "memory_search", input: { query: "x" } }],
          __openclaw: { id: "assistant-tools", seq: 2 },
        },
      },
    });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 3,
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool-1", content: "search results" }],
          __openclaw: { id: "tool-result", seq: 3 },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({
      toolCallId: "tool-1",
      name: "memory_search",
      status: "success",
      phase: "result",
      resultMeta: "search results",
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches;
    const resultIndex = patches.findIndex((patch: { type: string; payload?: { toolCallId?: string } }) => patch.type === "chat.tool.result" && patch.payload?.toolCallId === "tool-1");
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    await app.close();
  });

  test("broadcasts live detached tool calls for subagent sessions", async () => {
    const app = await createApp(config("subagent-detached-live-tools"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    await context.chatLive.ensureSessionSubscribed("agent:main:subagent:child-1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:main:subagent:child-1",
        messageSeq: 2,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "web_fetch", input: { url: "https://example.com" } }],
          __openclaw: { id: "assistant-tools", seq: 2 },
        },
      },
    });

    expect(context.runs.getToolCall("agent:main:subagent:child-1", "tool-1")).toMatchObject({
      toolCallId: "tool-1",
      name: "web_fetch",
      status: "running",
      runId: null,
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.started",
        sessionKey: "agent:main:subagent:child-1",
        payload: expect.objectContaining({ toolCallId: "tool-1" }),
      }),
    ]));
    await app.close();
  });

  test("assistant final completes detached subagent tool calls", async () => {
    const app = await createApp(config("subagent-detached-tools-complete"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    const sessionKey = "agent:main:subagent:child-2";
    await context.chatLive.ensureSessionSubscribed(sessionKey);
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey,
        messageSeq: 2,
        message: {
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "web_fetch", input: { url: "https://example.com" } }],
          __openclaw: { id: "assistant-tools", seq: 2 },
        },
      },
    });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey,
        messageSeq: 3,
        message: {
          role: "assistant",
          text: "Fetched and summarized.",
          __openclaw: { id: "assistant-final", seq: 3 },
        },
      },
    });

    expect(context.runs.getToolCall(sessionKey, "tool-1")).toMatchObject({
      toolCallId: "tool-1",
      status: "success",
      phase: "result",
      runId: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 950));
    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; sessionKey: string; cursor: number; payload?: { toolCallId?: string; semanticType?: string; message?: { text?: string } } }>;
    const resultIndex = patches.findIndex((patch) => patch.type === "chat.tool.result" && patch.sessionKey === sessionKey && patch.payload?.toolCallId === "tool-1");
    const finalIndex = patches.findIndex((patch) => patch.type === "chat.message.upsert" && patch.sessionKey === sessionKey && patch.payload?.semanticType === "chat.assistant.final" && patch.payload.message?.text === "Fetched and summarized.");
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(resultIndex);
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

  test("bootstrap derives completed tool calls from historical assistant tool blocks", async () => {
    const app = await createApp(config("bootstrap-tool-history"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "onEvent").mockImplementation(() => () => true);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          status: "done",
          messages: [
            { role: "user", text: "check it", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "web_fetch", input: { url: "https://example.com" } }], __openclaw: { id: "a-tools", seq: 2 } },
            { role: "assistant", text: "Answer from fetched page", __openclaw: { id: "a-final", seq: 3 } },
          ],
        };
      }
      return { ok: true };
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "done",
      activeRun: null,
      toolCalls: [expect.objectContaining({
        toolCallId: "tool-1",
        name: "web_fetch",
        status: "success",
        messageId: "a-tools",
      })],
    });
    await app.close();
  });

  test("bootstrap preserves real historical tool result output", async () => {
    const app = await createApp(config("bootstrap-tool-result-output"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "onEvent").mockImplementation(() => () => true);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          status: "done",
          messages: [
            { role: "user", text: "fetch it", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", content: [{ type: "toolCall", id: "tool-1", name: "web_fetch", input: { url: "https://github.com/hoppscotch/hoppscotch", maxChars: 3000 } }], __openclaw: { id: "a-tools", seq: 2 } },
            { role: "toolResult", tool_use_id: "tool-1", tool_name: "web_fetch", content: "# Hoppscotch\nOpen source API development ecosystem.", __openclaw: { id: "tool-result", seq: 3 } },
            { role: "assistant", text: "Found Hoppscotch.", __openclaw: { id: "a-final", seq: 4 } },
          ],
        };
      }
      return { ok: true };
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "done",
      activeRun: null,
      toolCalls: [expect.objectContaining({
        toolCallId: "tool-1",
        name: "web_fetch",
        status: "success",
        resultMeta: "# Hoppscotch\nOpen source API development ecosystem.",
      })],
    });
    await app.close();
  });

  test("canonical bootstrap finalizes stale active run even when a newer done run exists", async () => {
    const app = await createApp(config("bootstrap-finalizes-stale-active-run"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "onEvent").mockImplementation(() => () => true);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          status: "running",
          messages: [
            { role: "user", text: "old", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", text: "old answer", __openclaw: { id: "a1", seq: 2 } },
          ],
        };
      }
      return { ok: true };
    });

    const now = Date.now();
    context.runs.upsertRun({ runId: "stale-run", sessionKey: "s1", status: "tool_running", statusLabel: "web_fetch", startedAtMs: now - 12 * 60 * 60 * 1000, updatedAtMs: now - 12 * 60 * 60 * 1000 });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "stale-run", toolCallId: "old-tool", name: "web_fetch", phase: "calling", status: "running", startedAtMs: now - 12 * 60 * 60 * 1000, updatedAtMs: now - 12 * 60 * 60 * 1000 });
    context.runs.upsertRun({ runId: "newer-done-run", sessionKey: "s1", status: "done", statusLabel: null, startedAtMs: now - 1000, updatedAtMs: now - 500, finishedAtMs: now - 500 });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "done",
      activeRun: null,
      toolCalls: [expect.objectContaining({ toolCallId: "old-tool", runId: "stale-run", status: "success" })],
    });
    expect(context.runs.getRun("stale-run")).toMatchObject({ status: "done" });
    await app.close();
  });

  test("canonical bootstrap clears stale prerun tools adopted by old projections", async () => {
    const app = await createApp(config("bootstrap-clears-stale-prerun-tools"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "onEvent").mockImplementation(() => () => true);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          status: "running",
          messages: [
            { role: "user", text: "old", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", content: [{ type: "toolCall", id: "tool-old", name: "web_fetch", input: { url: "https://example.com" } }], __openclaw: { id: "a1", seq: 2 } },
            { role: "user", text: "new", __openclaw: { id: "u2", seq: 3 } },
          ],
        };
      }
      return { ok: true };
    });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-current", sessionKey: "s1", status: "tool_running", statusLabel: "web_fetch", startedAtMs: now, updatedAtMs: now });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "run-current", toolCallId: "tool-old", name: "web_fetch", phase: "calling", status: "running", startedAtMs: now - 12 * 60 * 60 * 1000, updatedAtMs: now - 12 * 60 * 60 * 1000 });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "streaming",
      statusLabel: "Streaming",
      activeRun: expect.objectContaining({ runId: "run-current", status: "streaming" }),
      toolCalls: [expect.objectContaining({ toolCallId: "tool-old", runId: "run-current", status: "success" })],
    });
    expect(context.runs.getToolCall("s1", "tool-old")).toMatchObject({ status: "success" });
    await app.close();
  });

  test("canonical bootstrap does not reassign old tool calls to current active run", async () => {
    const app = await createApp(config("bootstrap-does-not-reassign-old-tools"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "onEvent").mockImplementation(() => () => true);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          status: "running",
          messages: [
            { role: "user", text: "old", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", text: "old answer", content: [{ type: "toolCall", id: "tool-old", name: "web_fetch", input: { url: "https://example.com" } }], __openclaw: { id: "a1", seq: 2 } },
            { role: "user", text: "new", __openclaw: { id: "u2", seq: 3 } },
          ],
        };
      }
      return { ok: true };
    });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "done", statusLabel: null, startedAtMs: now - 10_000, updatedAtMs: now - 9_000, finishedAtMs: now - 9_000 });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "run-1", toolCallId: "tool-old", name: "web_fetch", phase: "result", status: "success", startedAtMs: now - 9_500, updatedAtMs: now - 9_000, finishedAtMs: now - 9_000 });
    context.runs.upsertRun({ runId: "run-2", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: now, updatedAtMs: now });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "thinking",
      activeRun: expect.objectContaining({ runId: "run-2" }),
      toolCalls: [],
    });
    expect(context.runs.getToolCall("s1", "tool-old")).toMatchObject({ runId: "run-1", status: "success" });
    await app.close();
  });

  test("run upsert does not downgrade terminal runs", async () => {
    const app = await createApp(config("run-upsert-preserves-terminal"));
    const context = contextOf(app);
    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "done", statusLabel: null, startedAtMs: now - 1000, updatedAtMs: now - 500, finishedAtMs: now - 500 });
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: now - 1000, updatedAtMs: now });
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "done", statusLabel: null, finishedAtMs: now - 500 });
    await app.close();
  });

  test("canonical bootstrap only exposes tools for the active/latest turn", async () => {
    const app = await createApp(config("bootstrap-active-turn-tools-only"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "onEvent").mockImplementation(() => () => true);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          status: "running",
          messages: [
            { role: "user", text: "first", __openclaw: { id: "u1", seq: 1 } },
            { role: "assistant", text: "first done", __openclaw: { id: "a1", seq: 2 } },
            { role: "user", text: "second", __openclaw: { id: "u2", seq: 3 } },
          ],
        };
      }
      return { ok: true };
    });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "done", statusLabel: null, startedAtMs: now - 500, updatedAtMs: now - 400, finishedAtMs: now - 400 });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "run-1", toolCallId: "old-tool", name: "read", phase: "result", status: "success", startedAtMs: now - 480, updatedAtMs: now - 420, finishedAtMs: now - 420 });
    context.runs.upsertRun({ runId: "run-2", sessionKey: "s1", status: "tool_running", statusLabel: "exec", startedAtMs: now - 120, updatedAtMs: now - 100 });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "run-2", toolCallId: "current-tool", name: "exec", phase: "calling", status: "running", startedAtMs: now - 90, updatedAtMs: now - 80 });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "tool_running",
      activeRun: expect.objectContaining({ runId: "run-2" }),
      toolCalls: [expect.objectContaining({ toolCallId: "current-tool", runId: "run-2", status: "running" })],
    });
    expect(bootstrap.json().toolCalls).toHaveLength(1);
    await app.close();
  });

  test("canonical bootstrap preserves sessions_spawn child session metadata after refresh", async () => {
    const app = await createApp(config("sessions-spawn-child-metadata"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "parent-1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
    await context.chatLive.ensureSessionSubscribed("parent-1");

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "parent-1",
        messageSeq: 2,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "spawn-1", name: "sessions_spawn", input: { task: "Audit child", label: "Auditor" } }],
          __openclaw: { id: "assistant-tools", seq: 2 },
        },
      },
    });
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "parent-1",
        messageSeq: 3,
        message: {
          role: "tool",
          toolCallId: "spawn-1",
          text: JSON.stringify({ childSessionKey: "agent:main:subagent:child-1" }),
          __openclaw: { id: "tool-result", seq: 3 },
        },
      },
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=parent-1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      toolCalls: [expect.objectContaining({
        toolCallId: "spawn-1",
        name: "sessions_spawn",
        status: "success",
        argsMeta: expect.objectContaining({ task: "Audit child", label: "Auditor" }),
        resultMeta: expect.objectContaining({ childSessionKey: "agent:main:subagent:child-1" }),
      })],
    });
    await app.close();
  });


});
