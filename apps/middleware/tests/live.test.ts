import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { GatewayEvent } from "../src/features/gateway/client.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { matchRecentConfirmedUserEcho, type RecentConfirmedUserEntry } from "../src/features/chat/live.js";

describe("matchRecentConfirmedUserEcho", () => {
  const confirmed: RecentConfirmedUserEntry = {
    id: "client-1",
    text: "hii",
    runId: "run:desktop-v2:agent:main:desktop:s1:idem-1",
    idempotencyKey: "idem-1",
    openclawSeq: 2,
    confirmedAtMs: Date.now(),
  };

  test("folds the fresh-chat duplicate user echo (higher live seq, same run) into the confirmed turn", () => {
    // Reproduces the new-chat bug: the duplicate echo has a real messageId, no
    // idempotency key, and a HIGHER live sequence than the confirmed turn, so a
    // seq-only guard would miss it. The shared runId catches it.
    const match = matchRecentConfirmedUserEcho({
      text: "hii",
      openclawSeq: 3,
      idempotencyKey: null,
      runId: "run:desktop-v2:agent:main:desktop:s1:idem-1",
      entries: [confirmed],
    });
    expect(match).toBe(confirmed);
  });

  test("matches by idempotency key regardless of sequence", () => {
    const match = matchRecentConfirmedUserEcho({
      text: "hii",
      openclawSeq: 99,
      idempotencyKey: "idem-1",
      runId: null,
      entries: [confirmed],
    });
    expect(match).toBe(confirmed);
  });

  test("folds stripped fresh-chat echo when run/idempotency are missing", () => {
    const match = matchRecentConfirmedUserEcho({
      text: "hii",
      openclawSeq: 5,
      idempotencyKey: null,
      runId: null,
      entries: [confirmed],
    });
    expect(match).toBe(confirmed);
  });

  test("keeps a genuine repeated send visible (different run, higher seq, no idempotency key)", () => {
    const match = matchRecentConfirmedUserEcho({
      text: "hii",
      openclawSeq: 5,
      idempotencyKey: null,
      runId: "run:desktop-v2:agent:main:desktop:s1:idem-2",
      entries: [confirmed],
    });
    expect(match).toBeNull();
  });

  test("keeps same-text messages visible when no confirmed run-backed entry exists", () => {
    const match = matchRecentConfirmedUserEcho({
      text: "hii",
      openclawSeq: 5,
      idempotencyKey: null,
      runId: null,
      entries: [{ ...confirmed, runId: undefined }],
    });
    expect(match).toBeNull();
  });

  test("still folds a lower/equal-seq replay echo when no run id is present", () => {
    const match = matchRecentConfirmedUserEcho({
      text: "hii",
      openclawSeq: 1,
      idempotencyKey: null,
      runId: null,
      entries: [confirmed],
    });
    expect(match).toBe(confirmed);
  });
});

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
  test("session.message preserves the canonical imported source key in middleware patches", async () => {
    const app = await createApp(config("canonical-imported-source-key-live-patch"));
    const context = contextOf(app);
    const sourceSessionKey = "agent:main:telegram:group:-1001:topic:42";
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    await context.chatLive.ensureSessionSubscribed(sourceSessionKey);
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: sourceSessionKey,
        messageSeq: 1,
        message: {
          role: "assistant",
          text: "Canonical source-key patch",
          __openclaw: { id: "canonical-source-message", seq: 1 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        sessionKey: sourceSessionKey,
        payload: expect.objectContaining({
          sessionKey: sourceSessionKey,
          messageId: "canonical-source-message",
        }),
      }),
    ]));
    await app.close();
  });

  test("assistant message without run id binds to oldest unanswered pending run", async () => {
    const app = await createApp(config("assistant-oldest-pending-run"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
    context.runs.upsertRun({ runId: "run-2", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 200, updatedAtMs: 200 });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 3,
        message: {
          role: "assistant",
          text: "first answer",
          __openclaw: { id: "assistant-1", seq: 3 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          messageId: "assistant-1",
          runId: "run-1",
        }),
      }),
    ]));
    expect(context.runs.getRun("run-1")).toMatchObject({ status: "done" });
    expect(context.runs.getRun("run-2")).toMatchObject({ status: "thinking" });
    await app.close();
  });

  test("assistant final replaces synthetic live assistant row for the same run", async () => {
    const app = await createApp(config("assistant-final-replaces-live"));
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
      event: "chat",
      payload: {
        sessionKey: "s1",
        status: "streaming",
        text: "Hello Dixit",
      },
    });
    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toMatchObject({ role: "assistant" });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 2,
        message: {
          role: "assistant",
          text: "Hello Dixit",
          __openclaw: { id: "assistant-final", seq: 2 },
        },
      },
    });

    const messages = context.messages.listMessages("s1");
    expect(messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toBeNull();
    expect(context.messages.findMessageById("s1", "assistant-final")).toMatchObject({
      role: "assistant",
      data: expect.objectContaining({ text: "Hello Dixit" }),
    });
    await app.close();
  });

  test("stripped canonical final replaces the preceding live row even when proxy formatting differs", async () => {
    const app = await createApp(config("stripped-final-replaces-live"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "streaming", statusLabel: "Streaming", startedAtMs: 100, updatedAtMs: 100 });
    await context.chatLive.ensureSessionSubscribed("s1");
    listener({ type: "event", event: "chat", payload: { sessionKey: "s1", status: "streaming", text: "Hello world" } });
    context.runs.updateRunStatus("run-1", "done", { statusLabel: null });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 2,
        message: { role: "assistant", text: "Hello, world.", __openclaw: { id: "gateway-final", seq: 2 } },
      },
    });

    expect(context.messages.listMessages("s1").filter((message) => message.role === "assistant")).toHaveLength(1);
    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toBeNull();
    expect(context.messages.findMessageById("s1", "gateway-final")).toMatchObject({ role: "assistant" });
    await app.close();
  });

  test("does not render proxy progress prose attached to a tool-use assistant turn as a final reply", async () => {
    const app = await createApp(config("tool-use-progress-prose"));
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
          text: "I've updated the proxy configuration. Restarting it now.",
          content: [
            { type: "text", text: "I've updated the proxy configuration. Restarting it now." },
            { type: "toolCall", id: "restart-proxy", name: "exec", arguments: { command: "restart proxy" } },
          ],
          stopReason: "toolUse",
          __openclaw: { id: "assistant-tool-progress", seq: 2, runId: "run-1" },
        },
      },
    });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 4,
        message: {
          role: "assistant",
          text: "Proxy setup is complete and validated.",
          __openclaw: { id: "assistant-final", seq: 4, runId: "run-1" },
        },
      },
    });

    const visibleAssistantTexts = context.messages.listMessages("s1")
      .filter((message) => message.role === "assistant")
      .map((message) => {
        const data = message.data as { text?: unknown };
        return typeof data.text === "string" ? data.text.trim() : "";
      })
      .filter(Boolean);

    expect(visibleAssistantTexts).toEqual(["Proxy setup is complete and validated."]);
    expect(context.runs.getToolCall("s1", "restart-proxy")).toMatchObject({ name: "exec", status: "running" });
    await app.close();
  });

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

  test("folds a later decorated Gateway user echo into the already confirmed optimistic user", async () => {
    const app = await createApp(config("dedupe-confirmed-user-echo"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    const now = Date.now();
    context.chatLive.addOptimisticUser("s1", { id: "client-1", text: "E2E_OK please", createdAtMs: now });
    context.messages.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 90,
      messageId: "prior-message",
      role: "assistant",
      data: { role: "assistant", text: "Prior legitimate message", __openclaw: { id: "prior-message", seq: 90 } },
      updatedAtMs: now - 1000,
    });
    context.messages.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 100,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "E2E_OK please", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1" } },
      updatedAtMs: now,
    });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 100,
        message: {
          role: "user",
          text: "E2E_OK please",
          __openclaw: { seq: 100 },
        },
      },
    });
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 90,
        message: {
          role: "user",
          text: "Sender (untrusted metadata):\n```json\n{}\n```\n\n[Fri 2026-05-22 05:44 UTC] E2E_OK please",
          __openclaw: { id: "gateway-duplicate", seq: 90 },
        },
      },
    });

    let userMessages = context.messages.listMessages("s1").filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({ messageId: "client-1", openclawSeq: 100 });
    expect(context.messages.findMessageById("s1", "prior-message")).toMatchObject({ role: "assistant", openclawSeq: 90 });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 101,
        message: {
          role: "user",
          text: "E2E_OK please",
          __openclaw: { id: "gateway-new-repeat", seq: 101 },
        },
      },
    });
    userMessages = context.messages.listMessages("s1").filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(2);
    expect(userMessages.map((message) => message.messageId)).toEqual(["client-1", "gateway-new-repeat"]);

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    const patches = replay.json().patches as Array<{ type: string; payload: { messageId?: string; optimisticId?: string } }>;
    expect(patches.filter((patch) => patch.type === "chat.message.confirmed" && patch.payload.optimisticId === "client-1")).toHaveLength(1);
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({ messageId: "gateway-duplicate" }),
      }),
    ]));
    await app.close();
  });

  test("folds the new-chat duplicate user echo that arrives with a higher live sequence (same run)", async () => {
    // Reproduces the fresh-chat send bug from the field log: the optimistic user
    // turn is confirmed at seq 2, then Gateway re-emits the same user message
    // with a real messageId, no idempotency key, and a HIGHER live sequence (3).
    // A seq-only guard misses this live (it is only caught later by backfill,
    // after the duplicate bubble already rendered). The shared runId catches it.
    const app = await createApp(config("dedupe-newchat-higher-seq-echo"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    const now = Date.now();
    const runId = "run:desktop-v2:agent:main:desktop:s1:idem-1";
    context.runs.upsertRun({ runId, sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: now, updatedAtMs: now });
    context.chatLive.addOptimisticUser("s1", { id: "client-1", text: "hii", runId, idempotencyKey: "idem-1", createdAtMs: now });
    context.messages.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 2,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "hii", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1", runId } },
      updatedAtMs: now,
    });

    await context.chatLive.ensureSessionSubscribed("s1");
    // First echo: matches + confirms the optimistic turn at seq 2.
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 2,
        message: { role: "user", text: "hii", __openclaw: { idempotencyKey: "idem-1", runId, seq: 2 } },
      },
    });
    // Second echo from the field log: decorated duplicate with real messageId,
    // no run id, no idempotency key, and the adjacent higher live sequence (3).
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 3,
        message: { role: "user", text: "hii", __openclaw: { id: "gateway-duplicate", seq: 3 } },
      },
    });

    const userMessages = context.messages.listMessages("s1").filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({ messageId: "client-1" });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    const patches = replay.json().patches as Array<{ type: string; payload: { messageId?: string } }>;
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({ messageId: "gateway-duplicate" }),
      }),
    ]));
    await app.close();
  });

  test("backfill skips canonical user echoes already confirmed live", async () => {
    const app = await createApp(config("backfill-confirmed-user-dedupe"));
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
            { role: "user", text: "E2E_OK please", __openclaw: { id: "gateway-user", seq: 88 } },
            { role: "assistant", text: "Done", __openclaw: { id: "gateway-assistant", seq: 89 } },
          ],
        };
      }
      return { ok: true };
    });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: now, updatedAtMs: now });
    context.chatLive.addOptimisticUser("s1", { id: "client-1", text: "E2E_OK please", runId: "run-1", createdAtMs: now });
    context.messages.insertOptimisticMessage({
      sessionKey: "s1",
      openclawSeq: 90,
      messageId: "client-1",
      role: "user",
      data: { role: "user", text: "E2E_OK please", isOptimistic: true, __clientOptimistic: true, __openclaw: { id: "client-1", runId: "run-1" } },
      updatedAtMs: now,
    });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 90,
        message: { role: "user", text: "E2E_OK please", __openclaw: { seq: 90 } },
      },
    });
    listener({
      type: "event",
      event: "chat",
      payload: { sessionKey: "s1", runId: "run-1", status: "final" },
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    const userMessages = context.messages.listMessages("s1").filter((message) => message.role === "user");
    expect(userMessages).toHaveLength(1);
    expect(userMessages[0]).toMatchObject({ messageId: "client-1", openclawSeq: 90 });
    expect(context.messages.findMessageById("s1", "gateway-user")).toBeNull();
    expect(context.messages.findMessageById("s1", "gateway-assistant")).toMatchObject({ role: "assistant" });
    await app.close();
  });

  test("backfill replaces live assistant delta with canonical final assistant", async () => {
    const app = await createApp(config("backfill-replaces-live-assistant"));
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
            { role: "user", text: "hello", __openclaw: { id: "gateway-user", seq: 1 } },
            { role: "assistant", text: "OLD_OK", __openclaw: { id: "gateway-old-assistant", seq: 2 } },
            { role: "user", text: "latest", __openclaw: { id: "gateway-latest-user", seq: 3 } },
            { role: "assistant", text: "FINAL_OK", __openclaw: { id: "gateway-assistant", seq: 4 } },
          ],
        };
      }
      return { ok: true };
    });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "streaming", statusLabel: "Streaming", startedAtMs: now, updatedAtMs: now });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "chat",
      payload: { sessionKey: "s1", runId: "run-1", data: { status: "streaming", text: "FINAL_OK" } },
    });
    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toMatchObject({ role: "assistant" });

    listener({
      type: "event",
      event: "chat",
      payload: { sessionKey: "s1", runId: "run-1", status: "final" },
    });

    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toBeNull();
    const assistants = context.messages.listMessages("s1").filter((message) => message.role === "assistant");
    expect(assistants).toHaveLength(2);
    expect(context.messages.findMessageById("s1", "gateway-old-assistant")?.data.__openclaw).not.toMatchObject({ runId: "run-1" });
    expect(context.messages.findMessageById("s1", "gateway-assistant")).toMatchObject({ messageId: "gateway-assistant", role: "assistant" });
    expect(context.messages.findMessageById("s1", "gateway-assistant")?.data.__openclaw).toMatchObject({ replacedLiveMessageId: "live:run-1:assistant", runId: "run-1" });

    listener({
      type: "event",
      event: "chat",
      payload: { sessionKey: "s1", runId: "run-1", data: { status: "streaming", text: "FINAL_OK" } },
    });
    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toBeNull();
    expect(context.messages.listMessages("s1").filter((message) => message.role === "assistant" && JSON.stringify(message.data).includes("FINAL_OK"))).toHaveLength(1);
    await app.close();
  });

  test("canonical assistant final replaces live assistant even when run already reached done", async () => {
    const app = await createApp(config("terminal-run-live-assistant-replace"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "streaming", statusLabel: "Streaming", startedAtMs: now, updatedAtMs: now });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "chat",
      payload: { sessionKey: "s1", runId: "run-1", data: { status: "streaming", text: "FINAL_OK" } },
    });
    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toMatchObject({ role: "assistant" });

    context.runs.updateRunStatus("run-1", "done", { statusLabel: null });
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 4,
        message: { role: "assistant", text: "FINAL_OK", __openclaw: { id: "gateway-final", seq: 4 } },
      },
    });

    expect(context.messages.findMessageById("s1", "live:run-1:assistant")).toBeNull();
    expect(context.messages.findMessageById("s1", "gateway-final")).toMatchObject({ openclawSeq: 1, role: "assistant" });
    expect(context.messages.findMessageById("s1", "gateway-final")?.data.__openclaw).toMatchObject({ replacedLiveMessageId: "live:run-1:assistant", runId: "run-1" });
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

  test("broadcasts nested gateway chat error text in live status patches", async () => {
    const app = await createApp(config("nested-chat-error"));
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
      event: "chat",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        data: {
          status: "error",
          error: "credit exhausted",
        },
      },
    });

    expect(context.runs.getRun("run-1")).toMatchObject({ status: "error", statusLabel: "credit exhausted" });
    expect(context.messages.getSession("s1")?.data).toMatchObject({ status: "error", statusLabel: "credit exhausted" });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.status",
        payload: expect.objectContaining({
          semanticType: "chat.run.error",
          runStatus: "error",
          statusLabel: "credit exhausted",
        }),
      }),
    ]));
    await app.close();
  });

  test("treats gateway-rejected chat events as terminal errors", async () => {
    const app = await createApp(config("gateway-rejected-chat-error"));
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
      event: "chat",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        status: "gateway-rejected",
        message: "runner rejected command",
      },
    });

    expect(context.runs.getRun("run-1")).toMatchObject({ status: "error", statusLabel: "runner rejected command" });
    expect(context.messages.getSession("s1")?.data).toMatchObject({ status: "error", statusLabel: "runner rejected command" });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.status",
        payload: expect.objectContaining({
          semanticType: "chat.run.error",
          runStatus: "error",
          statusLabel: "runner rejected command",
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

  test("does not broadcast duplicate tool patches when replayed tool state is unchanged", async () => {
    const app = await createApp(config("dedupe-unchanged-tool-patches"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", gatewayRunId: "gw-run-1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });

    await context.chatLive.ensureSessionSubscribed("s1");
    const event: GatewayEvent = {
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
    };

    listener(event);
    listener(event);

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const toolPatches = (replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string } }>)
      .filter((patch) => patch.type === "chat.tool.started" && patch.payload?.toolCallId === "tool-1");

    expect(toolPatches).toHaveLength(1);
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

  test("broadcasts live assistant deltas from Gateway agent text events", async () => {
    const app = await createApp(config("agent-assistant-text-events"));
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
      event: "agent.event",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        stream: "response",
        data: { delta: "Hel" },
      },
    });
    listener({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        stream: "response",
        data: { content: [{ type: "text", text: "lo" }] },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { semanticType?: string; message?: { text?: string } } }>;
    const textPatches = patches.filter((patch) => patch.type === "chat.message.upsert" && patch.payload?.semanticType === "chat.assistant.delta");
    expect(textPatches.map((patch) => patch.payload?.message?.text)).toEqual(["Hel", "Hello"]);
    await app.close();
  });

  test("does not infer missing result for previous sequential tool when the next tool starts", async () => {
    const app = await createApp(config("sequential-tool-no-inferred-result"));
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

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({ status: "running", phase: "calling" });
    expect(context.runs.getToolCall("s1", "tool-2")).toMatchObject({ status: "running", phase: "start", name: "read" });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string } }>;
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.result",
        payload: expect.objectContaining({ toolCallId: "tool-1" }),
      }),
    ]));
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.started",
        payload: expect.objectContaining({ toolCallId: "tool-2" }),
      }),
    ]));
    await app.close();
  });

  test("projects Gateway agent command_output deltas as live tool output", async () => {
    const app = await createApp(config("agent-command-output-live"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "agent:main:subagent:child-1", gatewayRunId: "gw-child-1", status: "tool_running", statusLabel: "exec", startedAtMs: 100, updatedAtMs: 100 });

    await context.chatLive.ensureSessionSubscribed("agent:main:subagent:child-1");
    listener({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:main:subagent:child-1",
        runId: "gw-child-1",
        stream: "item",
        data: { kind: "tool", phase: "start", toolCallId: "tool-exec", name: "exec", title: "exec printf" },
      },
    });
    listener({
      type: "event",
      event: "agent",
      payload: {
        sessionKey: "agent:main:subagent:child-1",
        runId: "gw-child-1",
        stream: "command_output",
        data: { phase: "delta", toolCallId: "tool-exec", name: "exec", output: "gateway_subagent_probe_result" },
      },
    });

    expect(context.runs.getToolCall("agent:main:subagent:child-1", "tool-exec")).toMatchObject({
      status: "running",
      phase: "update",
      resultMeta: "gateway_subagent_probe_result",
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string; phase?: string; output?: unknown; toolCall?: { status?: string; resultMeta?: unknown } } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.update",
        payload: expect.objectContaining({
          toolCallId: "tool-exec",
          phase: "update",
          output: "gateway_subagent_probe_result",
          toolCall: expect.objectContaining({ status: "running", resultMeta: "gateway_subagent_probe_result" }),
        }),
      }),
    ]));
    await app.close();
  });

  test("marks stripped live session.tool results as awaiting history output", async () => {
    const app = await createApp(config("stripped-session-tool-result"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    const request = vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "sessions.messages.subscribe") return { ok: true };
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          messages: [
            { role: "toolResult", toolCallId: "tool-live", content: [{ type: "text", text: "real output from history" }], __openclaw: { id: "tool-result-1", seq: 2 } },
          ],
        };
      }
      return { ok: true };
    });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", gatewayRunId: "gw-run-1", status: "tool_running", statusLabel: "read", startedAtMs: 100, updatedAtMs: 100 });
    context.runs.upsertToolCall({ sessionKey: "s1", runId: "run-1", toolCallId: "tool-live", name: "read", phase: "calling", status: "running", argsMeta: { path: "README.md" }, startedAtMs: 100, updatedAtMs: 100 });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.tool",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        data: {
          phase: "result",
          toolCallId: "tool-live",
          name: "read",
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-live")).toMatchObject({
      status: "success",
      resultMeta: expect.objectContaining({ awaitingResult: true, reason: "gateway_stripped_live_result" }),
    });

    let replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    let patches = replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string; toolCall?: { awaitingResult?: boolean; resultMeta?: unknown } } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.result",
        payload: expect.objectContaining({
          toolCallId: "tool-live",
          toolCall: expect.objectContaining({ awaitingResult: true, resultMeta: expect.objectContaining({ awaitingResult: true }) }),
        }),
      }),
    ]));

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(request).toHaveBeenCalledWith("chat.history", expect.objectContaining({ sessionKey: "s1" }));
    expect(context.runs.getToolCall("s1", "tool-live")).toMatchObject({ resultMeta: [{ type: "text", text: "real output from history" }] });

    replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    patches = replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string; toolCall?: { awaitingResult?: boolean; resultMeta?: unknown } } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.result",
        payload: expect.objectContaining({
          toolCallId: "tool-live",
          toolCall: expect.objectContaining({ resultMeta: [{ type: "text", text: "real output from history" }] }),
        }),
      }),
    ]));
    await app.close();
  });

  test("does not emit started patches for replayed terminal tool-call blocks", async () => {
    const app = await createApp(config("terminal-tool-start-replay"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertToolCall({
      sessionKey: "agent:main:subagent:child-1",
      toolCallId: "tool-live",
      name: "web_fetch",
      phase: "result",
      status: "success",
      resultMeta: { awaitingResult: true, reason: "gateway_agent_item_end_pending_history_result" },
      startedAtMs: 100,
      updatedAtMs: 200,
      finishedAtMs: 200,
    });

    await context.chatLive.ensureSessionSubscribed("agent:main:subagent:child-1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "agent:main:subagent:child-1",
        messageSeq: 3,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "tool-live", name: "web_fetch", input: { url: "https://example.com" } }],
          __openclaw: { id: "assistant-tool-replay", seq: 3 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string; toolCall?: { status?: string } } }>;
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.started",
        payload: expect.objectContaining({ toolCallId: "tool-live" }),
      }),
    ]));
    await app.close();
  });

  test("stripped live result does not overwrite existing real tool output", async () => {
    const app = await createApp(config("stripped-result-preserves-real-output"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", gatewayRunId: "gw-run-1", status: "tool_running", statusLabel: "web_fetch", startedAtMs: 100, updatedAtMs: 100 });
    context.runs.upsertToolCall({
      sessionKey: "s1",
      runId: "run-1",
      toolCallId: "tool-live",
      name: "web_fetch",
      phase: "result",
      status: "success",
      resultMeta: [{ type: "text", text: { url: "https://example.com", status: 200 } }],
      startedAtMs: 100,
      updatedAtMs: 200,
      finishedAtMs: 200,
    });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.tool",
      payload: {
        sessionKey: "s1",
        runId: "gw-run-1",
        data: { phase: "result", toolCallId: "tool-live", name: "web_fetch" },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-live")?.resultMeta).toEqual([{ type: "text", text: { url: "https://example.com", status: 200 } }]);
    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const resultPatch = (replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string; toolCall?: { awaitingResult?: boolean; resultMeta?: unknown } } }>).find((patch) => patch.type === "chat.tool.result" && patch.payload?.toolCallId === "tool-live");
    expect(resultPatch?.payload?.toolCall?.resultMeta).toEqual([{ type: "text", text: { url: "https://example.com", status: 200 } }]);
    expect(resultPatch?.payload?.toolCall?.awaitingResult).toBeUndefined();
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
        type: "chat.tool.update",
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

  test("marks tool_result payloads with status error as failed tool cards", async () => {
    const app = await createApp(config("message-tool-result-error-payload"));
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
          content: [{ type: "tool_use", id: "tool-1", name: "read", input: { path: "/tmp/missing" } }],
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
          role: "toolResult",
          toolCallId: "tool-1",
          content: { status: "error", tool: "read", error: "ENOENT: missing file" },
          __openclaw: { id: "tool-result-error", seq: 3 },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({
      toolCallId: "tool-1",
      name: "read",
      status: "error",
      phase: "error",
      resultMeta: { status: "error", tool: "read", error: "ENOENT: missing file" },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { toolCallId?: string; toolCall?: { status?: string; phase?: string; resultMeta?: unknown } } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.error",
        payload: expect.objectContaining({
          toolCallId: "tool-1",
          toolCall: expect.objectContaining({ status: "error", phase: "error" }),
        }),
      }),
    ]));
    await app.close();
  });

  test("marks wrapped text tool_result errors as failed tool cards", async () => {
    const app = await createApp(config("message-tool-result-wrapped-error-payload"));
    const context = contextOf(app);

    context.runs.upsertToolCall({
      sessionKey: "s1",
      runId: "run-1",
      toolCallId: "tool-1",
      name: "read",
      phase: "result",
      resultMeta: [{ type: "text", text: { status: "error", tool: "read", error: "ENOENT: missing file" } }],
      updatedAtMs: 200,
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({
      toolCallId: "tool-1",
      name: "read",
      status: "error",
      phase: "error",
      resultMeta: [{ type: "text", text: { status: "error", tool: "read", error: "ENOENT: missing file" } }],
    });

    await app.close();
  });

  test("broadcasts standalone tool result text as a live message patch", async () => {
    const app = await createApp(config("standalone-tool-result-message"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    await context.chatLive.ensureSessionSubscribed("s1");
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 3,
        message: {
          role: "tool",
          text: "Approval required (id exec-1, full approval-1)",
          __openclaw: { id: "tool-result-standalone", seq: 3 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { semanticType?: string; message?: { text?: string } } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          semanticType: "chat.tool.result",
          message: expect.objectContaining({ text: "Approval required (id exec-1, full approval-1)" }),
        }),
      }),
    ]));
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

  test("assistant final does not fabricate detached subagent tool success", async () => {
    const app = await createApp(config("subagent-detached-tools-no-fake-complete"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    const request = vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

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
      status: "running",
      phase: "calling",
      runId: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(request).toHaveBeenCalledWith("chat.history", expect.objectContaining({ sessionKey }));
    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; sessionKey: string; payload?: { toolCallId?: string } }>;
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.result",
        sessionKey,
        payload: expect.objectContaining({ toolCallId: "tool-1" }),
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

    const toolTurnPatches = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(toolTurnPatches.json().patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          messageId: "assistant-tools",
          semanticType: "chat.message.upsert",
        }),
      }),
    ]));
    expect(toolTurnPatches.json().patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          messageId: "assistant-tools",
          semanticType: "chat.assistant.final",
        }),
      }),
    ]));

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
          role: "toolResult",
          toolCallId: "tool-1",
          toolName: "read",
          content: [{ type: "text", text: "file contents" }],
          __openclaw: { id: "tool-result", seq: 3 },
        },
      },
    });

    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey: "s1",
        messageSeq: 4,
        message: {
          role: "assistant",
          text: "Done — I read the file.",
          __openclaw: { id: "assistant-final", seq: 4 },
        },
      },
    });

    expect(context.runs.getToolCall("s1", "tool-1")).toMatchObject({ status: "success", phase: "result", resultMeta: [{ type: "text", text: "file contents" }] });
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


  test("assistant thinking plus tool-call blocks never become assistant final in live patches", async () => {
    const app = await createApp(config("thinking-toolcall-not-final-live"));
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
          content: [
            { type: "thinking", text: "I need to inspect the file first." },
            { type: "toolCall", id: "tool-1", name: "read", input: { path: "README.md" } },
          ],
          __openclaw: { id: "assistant-thinking-tools", seq: 2 },
        },
      },
    });

    expect(context.runs.getRun("run-1")).toMatchObject({ status: "tool_running", statusLabel: "read" });
    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.statusCode).toBe(200);
    const patches = replay.json().patches as Array<{ type: string; payload?: { semanticType?: string; messageId?: string } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          messageId: "assistant-thinking-tools",
          semanticType: "chat.message.upsert",
        }),
      }),
      expect.objectContaining({
        type: "chat.tool.started",
        payload: expect.objectContaining({ toolCallId: "tool-1" }),
      }),
    ]));
    expect(patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          messageId: "assistant-thinking-tools",
          semanticType: "chat.assistant.final",
        }),
      }),
    ]));
    await app.close();
  });

  test("assistant answer text remains final even when message also contains tool calls", async () => {
    const app = await createApp(config("assistant-text-with-toolcall-is-final"));
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
          content: [
            { type: "toolCall", id: "tool-1", name: "read", input: { path: "README.md" } },
            { type: "text", text: "Done — the README says hello." },
          ],
          __openclaw: { id: "assistant-mixed-final", seq: 2 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { semanticType?: string; messageId?: string; toolCallId?: string; message?: { content?: unknown } } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "chat.tool.started", payload: expect.objectContaining({ toolCallId: "tool-1" }) }),
      expect.objectContaining({
        type: "chat.message.upsert",
        payload: expect.objectContaining({
          messageId: "assistant-mixed-final",
          semanticType: "chat.assistant.final",
        }),
      }),
    ]));
    await app.close();
  });

  test("canonical bootstrap does not reinterpret tool-call-only assistant history as final text", async () => {
    const app = await createApp(config("bootstrap-toolcall-only-not-final"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "onEvent").mockImplementation(() => () => true);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        return {
          sessionKey: "s1",
          sessionId: "session-1",
          status: "running",
          messages: [
            { role: "user", text: "inspect README", __openclaw: { id: "u1", seq: 1 } },
            {
              role: "assistant",
              content: [
                { type: "thinking", text: "Reading first." },
                { type: "toolCall", id: "tool-1", name: "read", input: { path: "README.md" } },
              ],
              __openclaw: { id: "a-tools", seq: 2 },
            },
          ],
        };
      }
      return { ok: true };
    });

    const now = Date.now();
    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: now, updatedAtMs: now });
    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json()).toMatchObject({
      runStatus: "tool_running",
      activeRun: expect.objectContaining({ runId: "run-1", status: "tool_running" }),
      messages: expect.arrayContaining([
        expect.objectContaining({ role: "assistant", __openclaw: expect.objectContaining({ id: "a-tools" }) }),
      ]),
      toolCalls: [expect.objectContaining({ toolCallId: "tool-1", name: "read", status: "running" })],
    });
    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    expect(replay.json().patches).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ payload: expect.objectContaining({ semanticType: "chat.assistant.final", messageId: "a-tools" }) }),
    ]));
    await app.close();
  });

  test("subagent child read tool result patch is emitted before child final text", async () => {
    const app = await createApp(config("subagent-read-result-before-final"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    const sessionKey = "agent:main:subagent:child-read";
    await context.chatLive.ensureSessionSubscribed(sessionKey);
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey,
        messageSeq: 2,
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: "read-1", name: "read", input: { path: "README.md" } }],
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
          role: "tool",
          toolCallId: "read-1",
          text: "README contents",
          __openclaw: { id: "tool-result", seq: 3 },
        },
      },
    });
    listener({
      type: "event",
      event: "session.message",
      payload: {
        sessionKey,
        messageSeq: 4,
        message: {
          role: "assistant",
          text: "The README says hello.",
          __openclaw: { id: "assistant-final", seq: 4 },
        },
      },
    });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; sessionKey: string; payload?: { toolCallId?: string; semanticType?: string; message?: { text?: string }; toolCall?: { resultMeta?: unknown } } }>;
    const resultIndex = patches.findIndex((patch) => patch.type === "chat.tool.result" && patch.sessionKey === sessionKey && patch.payload?.toolCallId === "read-1");
    const finalIndex = patches.findIndex((patch) => patch.type === "chat.message.upsert" && patch.sessionKey === sessionKey && patch.payload?.semanticType === "chat.assistant.final" && patch.payload.message?.text === "The README says hello.");
    expect(resultIndex).toBeGreaterThanOrEqual(0);
    expect(finalIndex).toBeGreaterThan(resultIndex);
    expect(patches[resultIndex]?.payload?.toolCall?.resultMeta).toBe("README contents");
    await app.close();
  });

  test("duplicate replayed tool-call turns do not create tool-call-only assistant finals", async () => {
    const app = await createApp(config("duplicate-toolcall-replay-no-final"));
    const context = contextOf(app);
    let listener: (event: GatewayEvent) => void = () => undefined;
    vi.spyOn(context.gateway, "onEvent").mockImplementation((cb) => {
      listener = cb;
      return () => true;
    });
    vi.spyOn(context.gateway, "request").mockResolvedValue({ ok: true });

    context.runs.upsertRun({ runId: "run-1", sessionKey: "s1", status: "thinking", statusLabel: "Thinking", startedAtMs: 100, updatedAtMs: 100 });
    await context.chatLive.ensureSessionSubscribed("s1");
    const toolTurn = {
      role: "assistant",
      content: [{ type: "toolCall", id: "tool-1", name: "read", input: { path: "README.md" } }],
      __openclaw: { id: "assistant-tools", seq: 2 },
    };
    listener({ type: "event", event: "session.message", payload: { sessionKey: "s1", messageSeq: 2, message: toolTurn } });
    listener({ type: "event", event: "session.message", payload: { sessionKey: "s1", messageSeq: 2, message: toolTurn } });
    listener({ type: "event", event: "session.message", payload: { sessionKey: "s1", messageSeq: 3, message: { role: "assistant", text: "Done.", __openclaw: { id: "assistant-final", seq: 3 } } } });
    listener({ type: "event", event: "session.message", payload: { sessionKey: "s1", messageSeq: 2, message: { ...toolTurn, __openclaw: { id: "assistant-tools-replayed", seq: 2 } } } });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; payload?: { semanticType?: string; messageId?: string } }>;
    const toolOnlyFinals = patches.filter((patch) => patch.type === "chat.message.upsert" && patch.payload?.semanticType === "chat.assistant.final" && (patch.payload.messageId === "assistant-tools" || patch.payload.messageId === "assistant-tools-replayed"));
    expect(toolOnlyFinals).toHaveLength(0);
    expect(patches.filter((patch) => patch.type === "chat.message.upsert" && patch.payload?.semanticType === "chat.assistant.final" && patch.payload.messageId === "assistant-final")).toHaveLength(1);
    await app.close();
  });

  test("main parent receives session_status and sessions_spawn tool result patches", async () => {
    const app = await createApp(config("parent-control-tool-results"));
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
          content: [
            { type: "toolCall", id: "status-1", name: "session_status", input: {} },
            { type: "toolCall", id: "spawn-1", name: "sessions_spawn", input: { task: "Audit", label: "Auditor" } },
          ],
          __openclaw: { id: "assistant-tools", seq: 2 },
        },
      },
    });
    listener({ type: "event", event: "session.message", payload: { sessionKey: "parent-1", messageSeq: 3, message: { role: "tool", toolCallId: "status-1", text: JSON.stringify({ model: "gpt-5.5", reasoning: "off" }), __openclaw: { id: "status-result", seq: 3 } } } });
    listener({ type: "event", event: "session.message", payload: { sessionKey: "parent-1", messageSeq: 4, message: { role: "tool", toolCallId: "spawn-1", text: JSON.stringify({ childSessionKey: "agent:main:subagent:child-1" }), __openclaw: { id: "spawn-result", seq: 4 } } } });

    const replay = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0" });
    const patches = replay.json().patches as Array<{ type: string; sessionKey: string; payload?: { toolCallId?: string; toolCall?: { name?: string; status?: string; resultMeta?: unknown } } }>;
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "chat.tool.result",
        sessionKey: "parent-1",
        payload: expect.objectContaining({
          toolCallId: "status-1",
          toolCall: expect.objectContaining({ name: "session_status", status: "success", resultMeta: expect.objectContaining({ model: "gpt-5.5" }) }),
        }),
      }),
      expect.objectContaining({
        type: "chat.tool.result",
        sessionKey: "parent-1",
        payload: expect.objectContaining({
          toolCallId: "spawn-1",
          toolCall: expect.objectContaining({ name: "sessions_spawn", status: "success", resultMeta: expect.objectContaining({ childSessionKey: "agent:main:subagent:child-1" }) }),
        }),
      }),
    ]));
    await app.close();
  });


});
