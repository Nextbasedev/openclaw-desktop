import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-send-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

async function waitFor(condition: () => boolean, timeoutMs = 500) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat send routes", () => {
  test("resolves exec approval through Gateway", async () => {
    const app = await createApp(config("approval-resolve"));
    const context = contextOf(app);
    const request = vi.spyOn(context.gateway, "request").mockResolvedValue({ resolved: true });
    const res = await app.inject({
      method: "POST",
      url: "/api/exec/approval/resolve",
      payload: { approvalId: "approval-1", decision: "allow-once" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, approvalId: "approval-1", decision: "allow-once", resolved: true });
    expect(request).toHaveBeenCalledWith("exec.approval.resolve", { id: "approval-1", decision: "allow-once" }, 30_000);
    await app.close();
  });

  test("returns structured errors for invalid or missing approval ids", async () => {
    const app = await createApp(config("approval-errors"));
    const context = contextOf(app);

    const missing = await app.inject({
      method: "POST",
      url: "/api/exec/approval/resolve",
      payload: { decision: "deny" },
    });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ ok: false, error: { code: "BAD_REQUEST", message: "approvalId is required" } });

    vi.spyOn(context.gateway, "request").mockRejectedValue(new Error("approval request not found"));
    const notFound = await app.inject({
      method: "POST",
      url: "/api/exec/approval/resolve",
      payload: { approvalId: "missing-approval", decision: "deny" },
    });
    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toMatchObject({ ok: false, error: { code: "APPROVAL_NOT_FOUND", details: { approvalId: "missing-approval" } } });
    await app.close();
  });

  test("validates idempotencyKey", async () => {
    const app = await createApp(config("validation"));
    const res = await app.inject({ method: "POST", url: "/api/chat/send", payload: { sessionKey: "s1", text: "hi" } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  test("broadcasts the user message before forwarding to Gateway chat.send", async () => {
    const app = await createApp(config("optimistic-patch"));
    const context = contextOf(app);
    const patches: unknown[] = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch); });
    const gatewayRequest = vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      return method === "chat.send" ? { runId: "r1" } : { ok: true };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(context.chatLive.diagnostics().optimisticUserSessions).toBe(1);
    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      source: "middleware-projection",
      messageCount: 1,
      messages: [{ role: "user", text: "hello", __openclaw: { id: "client-ui-1" } }],
    });
    expect(patches[0]).toMatchObject({
      type: "chat.message.upsert",
      sessionKey: "s1",
      payload: {
        projectionVersion: 3,
        semanticType: "chat.user.created",
        runStatus: "thinking",
        status: "thinking",
        activeRun: { runId: "run:stable-key" },
        optimistic: true,
        idempotencyKey: "stable-key",
        messageId: "client-ui-1",
        message: {
          role: "user",
          text: "hello",
          isOptimistic: true,
          __clientOptimistic: true,
          __openclaw: { id: "client-ui-1" },
        },
      },
    });
    expect(gatewayRequest).toHaveBeenCalledWith("chat.send", expect.objectContaining({
      sessionKey: "s1",
      message: "hello",
    }), expect.any(Number));
    expect(gatewayRequest).not.toHaveBeenCalledWith("sessions.patch", expect.objectContaining({ model: expect.anything() }));
    expect(patches[1]).toMatchObject({
      type: "chat.status",
      sessionKey: "s1",
      payload: {
        projectionVersion: 3,
        semanticType: "chat.run.status",
        runStatus: "thinking",
        status: "thinking",
        statusLabel: "Thinking",
        activeRun: { runId: "run:stable-key" },
        optimistic: true,
        idempotencyKey: "stable-key",
      },
    });
    await app.close();
  });

  test("bootstrap keeps pending optimistic user when Gateway history is missing the user echo", async () => {
    const app = await createApp(config("bootstrap-optimistic-conflict"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "r1" };
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          messages: [
            {
              role: "assistant",
              text: "assistant arrived before user echo",
              __openclaw: { id: "assistant-seq-1", seq: 1 },
            },
          ],
        };
      }
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "pending user", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(send.statusCode).toBe(200);

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      source: "middleware-projection",
      messageCount: 2,
      messages: [
        { role: "user", text: "pending user", __openclaw: { id: "client-ui-1" } },
        { role: "assistant", text: "assistant arrived before user echo", __openclaw: { id: "assistant-seq-1", seq: 1 } },
      ],
    });
    await app.close();
  });

  test("send does not clear Thinking from terminal ack before assistant projection", async () => {
    const app = await createApp(config("send-status-refresh"));
    const context = contextOf(app);
    const patches: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch as typeof patches[number]); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "r1", status: "done" };
      if (method === "chat.history") return { sessionKey: "s1", messages: [] };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(send.statusCode).toBe(200);
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.status", payload: expect.objectContaining({ status: "done", runId: "run:stable-key" }) }),
    ]));

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      sessionStatus: "running",
      runStatus: "thinking",
      activeRun: { runId: "run:stable-key", status: "thinking" },
    });
    await app.close();
  });

  test("send does not finish current run from stale pre-send Gateway history", async () => {
    const app = await createApp(config("send-stale-history-current-run"));
    const context = contextOf(app);
    const patches: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    const staleHistory = Array.from({ length: 52 }, (_, index) => {
      const seq = index + 1;
      return {
        role: seq % 2 === 0 ? "assistant" : "user",
        text: seq === 52 ? "old assistant answer" : `old message ${seq}`,
        __openclaw: { id: `old-${seq}`, seq },
      };
    });
    context.messages.upsertMessages(staleHistory.map((message) => ({
      sessionKey: "s1",
      openclawSeq: message.__openclaw.seq,
      messageId: message.__openclaw.id,
      role: message.role,
      data: message,
      updatedAtMs: Date.now(),
    })));
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch as typeof patches[number]); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { accepted: true, runId: "gateway-run-1", status: "started" };
      if (method === "chat.history") return { sessionKey: "s1", messages: staleHistory };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "current user message", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });

    expect(send.statusCode).toBe(200);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.message.upsert", payload: expect.objectContaining({ message: expect.objectContaining({ role: "user", text: "current user message" }) }) }),
      expect.objectContaining({ type: "chat.status", payload: expect.objectContaining({ status: "thinking", activeRun: expect.objectContaining({ runId: "run:stable-key" }) }) }),
    ]));
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.message.upsert", payload: expect.objectContaining({ semanticType: "chat.assistant.final", messageSeq: 52, runId: "run:stable-key" }) }),
      expect.objectContaining({ type: "chat.status", payload: expect.objectContaining({ status: "done", runId: "run:stable-key" }) }),
    ]));

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      sessionStatus: "running",
      runStatus: "thinking",
      activeRun: { runId: "run:stable-key", status: "thinking" },
    });
    const messages = bootstrap.json().messages as Array<{ role: string; text?: string; __openclaw?: { id?: string } }>;
    expect(messages[52]).toMatchObject({ role: "user", text: "current user message", __openclaw: { id: "client-ui-1" } });
    await app.close();
  });

  test("live chat delta broadcasts streaming status and assistant text for current run", async () => {
    const app = await createApp(config("live-chat-delta-status"));
    const context = contextOf(app);
    const patches: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch as typeof patches[number]); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { accepted: true, runId: "gateway-run-1", status: "started" };
      if (method === "chat.history") return { sessionKey: "s1", messages: [] };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(send.statusCode).toBe(200);

    const listeners = (context.gateway as unknown as { listeners: Set<(event: { type: "event"; event: string; payload?: unknown }) => void> }).listeners;
    for (const listener of listeners) {
      listener({ type: "event", event: "chat", payload: { sessionKey: "s1", runId: "gateway-run-1", delta: "partial" } });
    }

    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.status",
        payload: expect.objectContaining({
          semanticType: "chat.run.streaming",
          runStatus: "streaming",
          status: "streaming",
          statusLabel: "Streaming",
          activeRun: expect.objectContaining({ runId: "run:stable-key", status: "streaming" }),
        }),
      }),
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          semanticType: "chat.assistant.delta",
          runStatus: "streaming",
          messageId: "live:run:stable-key:assistant",
          message: expect.objectContaining({ role: "assistant", text: "partial" }),
        }),
      }),
    ]));
    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      sessionStatus: "running",
      runStatus: "streaming",
      statusLabel: "Streaming",
    });
    expect(bootstrap.json().messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "assistant", text: "partial" }),
    ]));
    await app.close();
  });

  test("live chat delta accepts nested gateway payloads and accumulates text patches", async () => {
    const app = await createApp(config("live-chat-nested-delta"));
    const context = contextOf(app);
    const patches: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch as typeof patches[number]); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { accepted: true, runId: "gateway-run-1", status: "started" };
      if (method === "chat.history") return { sessionKey: "s1", messages: [] };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(send.statusCode).toBe(200);

    const listeners = (context.gateway as unknown as { listeners: Set<(event: { type: "event"; event: string; payload?: unknown }) => void> }).listeners;
    for (const listener of listeners) {
      listener({ type: "event", event: "chat.delta", payload: { data: { key: "s1", runId: "gateway-run-1", message: { delta: "Hel" } } } });
      listener({ type: "event", event: "chat.delta", payload: { data: { key: "s1", runId: "gateway-run-1", chunk: { text: "lo" } } } });
    }

    const textPatches = patches.filter((patch) => patch.type === "chat.message.upsert" && patch.payload?.semanticType === "chat.assistant.delta");
    expect(textPatches.map((patch) => (patch.payload?.message as { text?: string } | undefined)?.text)).toEqual(["Hel", "Hello"]);
    await app.close();
  });

  test("send keeps projected running status when Gateway only accepts an async run", async () => {
    const app = await createApp(config("send-status-started"));
    const context = contextOf(app);
    const patches: unknown[] = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { accepted: true, runId: "r1", status: "started" };
      if (method === "chat.history") return { sessionKey: "s1", messages: [] };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(send.statusCode).toBe(200);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.status", payload: expect.objectContaining({ status: "thinking" }) }),
    ]));
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.status", payload: expect.objectContaining({ status: "done" }) }),
    ]));

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ sessionStatus: "running" });
    await app.close();
  });

  test("send reconciles Gateway history after chat.send so UI recovers missed live events", async () => {
    const app = await createApp(config("send-history-reconcile"));
    const context = contextOf(app);
    const patches: unknown[] = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "r1" };
      if (method === "chat.history") return {
        sessionKey: "s1",
        messages: [
          { role: "user", text: "hello", __openclaw: { id: "u1", seq: 1 } },
          { role: "assistant", text: "world", __openclaw: { id: "a1", seq: 2 } },
        ],
      };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(send.statusCode).toBe(200);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.message.upsert", payload: expect.objectContaining({ message: expect.objectContaining({ role: "assistant", text: "world" }) }) }),
      expect.objectContaining({ type: "chat.status", payload: expect.objectContaining({ status: "done" }) }),
    ]));

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      sessionStatus: "done",
      messages: [
        { role: "user", text: "hello" },
        { role: "assistant", text: "world" },
      ],
    });
    await app.close();
  });

  test("confirms and replaces optimistic user when gateway history echoes the sent message", async () => {
    const app = await createApp(config("send-history-confirms-optimistic"));
    const context = contextOf(app);
    const patches: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch as typeof patches[number]); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "r1", status: "done" };
      if (method === "chat.history") return {
        sessionKey: "s1",
        messages: [
          { role: "user", text: "> prior\n\nhello", __openclaw: { id: "gateway-user-1", seq: 1 } },
          { role: "assistant", text: "world", __openclaw: { id: "a1", seq: 2 } },
        ],
      };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });

    expect(send.statusCode).toBe(200);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.confirmed",
        payload: expect.objectContaining({
          optimisticId: "client-ui-1",
          message: expect.objectContaining({ role: "user", text: "> prior\n\nhello" }),
        }),
      }),
    ]));

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    const messages = bootstrap.json().messages as Array<{ role: string; text?: string }>;
    expect(messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(messages).toMatchObject([
      { role: "user", text: "> prior\n\nhello" },
      { role: "assistant", text: "world" },
    ]);
    await app.close();
  });

  test("does not confirm current optimistic user with stale latest Gateway user history", async () => {
    const app = await createApp(config("send-history-stale-user-no-confirm"));
    const context = contextOf(app);
    const patches: Array<{ type: string; payload?: Record<string, unknown> }> = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch as typeof patches[number]); });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "r1", status: "done" };
      if (method === "chat.history") return {
        sessionKey: "s1",
        messages: [
          { role: "user", text: "byy", __openclaw: { id: "stale-user", seq: 1 } },
          { role: "assistant", text: "Bye Dixit 🤝 Sleep well.", __openclaw: { id: "stale-assistant", seq: 2 } },
        ],
      };
      return { ok: true };
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "good night now", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });

    expect(send.statusCode).toBe(200);
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.confirmed",
        payload: expect.objectContaining({ optimisticId: "client-ui-1" }),
      }),
    ]));

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    const messages = bootstrap.json().messages as Array<{ role: string; text?: string; __openclaw?: { id?: string } }>;
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", text: "good night now", __openclaw: expect.objectContaining({ id: "client-ui-1" }) }),
    ]));
    expect(messages.filter((message) => message.role === "user" && message.text === "byy")).toHaveLength(1);
    await app.close();
  });

  test("bootstrap preserves projected running session status for refresh recovery", async () => {
    const app = await createApp(config("bootstrap-status"));
    const context = contextOf(app);
    context.messages.upsertSession({ sessionKey: "s1", sessionId: null, data: { sessionKey: "s1", status: "running" } });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") return { sessionKey: "s1", messages: [{ role: "user", text: "hello", __openclaw: { id: "u1", seq: 1 } }] };
      return { ok: true };
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({ sessionStatus: "running" });
    await app.close();
  });


  test("bootstrap exposes canonical run, tool, cursor, and projection fields while preserving legacy fields", async () => {
    const app = await createApp(config("bootstrap-canonical-shape"));
    const context = contextOf(app);
    context.messages.upsertSession({ sessionKey: "s1", sessionId: "sid-1", data: { sessionKey: "s1", status: "running", statusLabel: "Thinking" } });
    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", clientMessageId: "client-1", idempotencyKey: "idem-1", gatewayRunId: "gateway-run-1", status: "tool_running", statusLabel: "web_search", startedAtMs: now - 100, updatedAtMs: now - 50 });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "run-1", toolCallId: "tool-1", name: "web_search", phase: "start", argsMeta: { keys: ["q"] }, startedAtMs: now - 90, updatedAtMs: now - 75 });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") return { sessionKey: "s1", sessionId: "sid-1", messages: [{ role: "user", text: "hello", __openclaw: { id: "u1", seq: 1 } }] };
      return { ok: true };
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      ok: true,
      source: "middleware-projection",
      projectionVersion: 3,
      sessionKey: "s1",
      sessionId: "sid-1",
      runStatus: "tool_running",
      statusLabel: "web_search",
      activeRun: { runId: "run-1", gatewayRunId: "gateway-run-1", status: "tool_running", startedAtMs: now - 100 },
      tools: [{ toolCallId: "tool-1", id: "tool-1", runId: "run-1", name: "web_search", status: "running", argsMeta: { keys: ["q"] } }],
      toolCalls: [{ toolCallId: "tool-1" }],
      cursor: expect.any(Number),
      sessionStatus: "running",
      projection: { enabled: true, version: 3, cursor: expect.any(Number), liveSubscribed: true },
      messages: [{ role: "user", text: "hello" }],
    });
    expect(bootstrap.json().projection.cursor).toBe(bootstrap.json().cursor);
    await app.close();
  });

  test("logs send lifecycle metadata without user message content", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const app = await createApp(config("send-logs"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "r1", status: "done" };
      if (method === "chat.history") return { sessionKey: "s1", messages: [] };
      return { ok: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: {
        sessionKey: "s1",
        text: "super secret user message",
        idempotencyKey: "stable-key",
        attachments: [{ name: "safe.txt", mimeType: "text/plain", size: 12, content: "secret file content" }],
      },
    });
    expect(res.statusCode).toBe(200);
    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("send.start");
    expect(output).toContain("session.status.persist");
    expect(output).toContain("safe.txt");
    expect(output).not.toContain("super secret user message");
    expect(output).not.toContain("secret file content");
    await app.close();
    spy.mockRestore();
  });

  test("forwards stable idempotencyKey to Gateway chat.send", async () => {
    const app = await createApp(config("forward"));
    const context = contextOf(app);
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params: params ?? {} });
      return method === "chat.send" ? { runId: "r1" } : { ok: true };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key" },
    });
    expect(res.statusCode).toBe(200);
    const sendCall = calls.find((call) => call.method === "chat.send");
    expect(sendCall?.params).toMatchObject({ sessionKey: "s1", message: "hello", idempotencyKey: "stable-key" });
    await app.close();
  });

  test("accepts send before Gateway chat.send finishes", async () => {
    const app = await createApp(config("accept-before-gateway"));
    const context = contextOf(app);
    let resolveGatewaySend: ((value: Record<string, unknown>) => void) | null = null;
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method !== "chat.send") return { ok: true };
      return await new Promise<Record<string, unknown>>((resolve) => {
        resolveGatewaySend = resolve;
      });
    });
    const res = await app.inject({ method: "POST", url: "/api/chat/send", payload: { sessionKey: "s1", text: "first", idempotencyKey: "one", clientMessageId: "client-one" } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, accepted: true, sessionKey: "s1", idempotencyKey: "one", clientMessageId: "client-one" });
    expect(resolveGatewaySend).toBeTypeOf("function");
    resolveGatewaySend?.({ runId: "r1", status: "started" });
    await waitFor(() => context.runs.getRun("run:one")?.gatewayRunId === "r1");
    await app.close();
  });

  test("marks follow-up send queued until its queue turn starts", async () => {
    const app = await createApp(config("queued-follow-up-status"));
    const context = contextOf(app);
    const patches: Array<{ type: string; payload?: { clientMessageId?: string | null; runStatus?: string; statusLabel?: string | null } }> = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => { patches.push(patch as (typeof patches)[number]); });
    let resolveFirst: ((value: Record<string, unknown>) => void) | null = null;
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method !== "chat.send") return method === "chat.history" ? { messages: [] } : { ok: true };
      if (params?.idempotencyKey === "one") {
        return await new Promise<Record<string, unknown>>((resolve) => { resolveFirst = resolve; });
      }
      return { runId: "r2", status: "started" };
    });

    const first = await app.inject({ method: "POST", url: "/api/chat/send", payload: { sessionKey: "s1", text: "first", idempotencyKey: "one", clientMessageId: "client-one" } });
    expect(first.statusCode).toBe(200);
    await waitFor(() => typeof resolveFirst === "function");
    const second = await app.inject({ method: "POST", url: "/api/chat/send", payload: { sessionKey: "s1", text: "second", idempotencyKey: "two", clientMessageId: "client-two" } });
    expect(second.statusCode).toBe(200);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ clientMessageId: "client-two", runStatus: "queued", statusLabel: "Queued" }) }),
    ]));

    resolveFirst?.({ runId: "r1", status: "started" });
    await waitFor(() => patches.some((patch) => patch.payload?.clientMessageId === "client-two" && patch.payload?.runStatus === "thinking"));
    await app.close();
  });

  test("serializes sends per session", async () => {
    const app = await createApp(config("queue"));
    const context = contextOf(app);
    const order: string[] = [];
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method !== "chat.send") return { ok: true };
      order.push(`start:${params?.idempotencyKey}`);
      await new Promise((resolve) => setTimeout(resolve, params?.idempotencyKey === "one" ? 40 : 0));
      order.push(`end:${params?.idempotencyKey}`);
      return { runId: params?.idempotencyKey };
    });
    const first = app.inject({ method: "POST", url: "/api/chat/send", payload: { sessionKey: "s1", text: "first", idempotencyKey: "one" } });
    const second = app.inject({ method: "POST", url: "/api/chat/send", payload: { sessionKey: "s1", text: "second", idempotencyKey: "two" } });
    await Promise.all([first, second]);
    await waitFor(() => order.length === 4);
    expect(order).toEqual(["start:one", "end:one", "start:two", "end:two"]);
    await app.close();
  });

  test("abort forwards to Gateway chat.abort", async () => {
    const app = await createApp(config("abort"));
    const context = contextOf(app);
    const request = vi.spyOn(context.gateway, "request").mockResolvedValue({ aborted: true });
    const res = await app.inject({ method: "POST", url: "/api/chat/abort", payload: { sessionKey: "s1", runId: "r1" } });
    expect(res.statusCode).toBe(200);
    expect(request).toHaveBeenCalledWith("chat.abort", { sessionKey: "s1", runId: "r1" }, 30_000);
    await app.close();
  });
});
