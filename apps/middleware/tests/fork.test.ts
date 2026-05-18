import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-fork-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("chat fork compatibility command", () => {
  test("creates a forked Gateway session with copied history and source metadata", async () => {
    const app = await createApp(config("create"));
    const context = contextOf(app);
    const sourceMessages = [
      { role: "user", text: "one", __openclaw: { id: "msg-1", seq: 1 } },
      { role: "assistant", text: "two", messageId: "ui-msg-2", gatewayIndex: 123, __openclaw: { id: "msg-2", seq: 2 } },
      { role: "user", text: "three", __openclaw: { id: "msg-3", seq: 3 } },
    ];
    const transcriptPath = path.join(os.tmpdir(), `openclaw-fork-${Date.now()}-${Math.random()}.jsonl`);
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      calls.push({ method, payload: payload ?? {} });
      if (method === "chat.history" && payload?.sessionKey === "agent:main:desktop:source") {
        return { sessionKey: payload.sessionKey, messages: sourceMessages };
      }
      if (method === "chat.history") return { sessionKey: payload?.sessionKey, messages: [] };
      if (method === "sessions.create") return { entry: { sessionFile: transcriptPath, sessionId: payload?.key } };
      return { ok: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: { input: { sessionKey: "agent:main:desktop:source", messageId: "msg-2", gatewayIndex: 2 } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, sourceSessionKey: "agent:main:desktop:source", sourceMessageId: "msg-2" });
    expect(body.sessionKey).toMatch(/^agent:main:desktop:fork-/);
    expect(body.messages).toHaveLength(2);
    expect(calls.find((call) => call.method === "sessions.create")?.payload).toMatchObject({
      key: body.sessionKey,
      agentId: "main",
      parentSessionKey: "agent:main:desktop:source",
    });
    expect(transcriptPath && transcriptPath.length > 0).toBe(true);
    const transcriptLines = fs.readFileSync(transcriptPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(transcriptLines).toMatchObject([
      { type: "session" },
      { id: "msg-1", message: { role: "user", text: "one" } },
      { id: "msg-2", message: { role: "assistant", text: "two" } },
    ]);
    expect(transcriptLines).toHaveLength(3);
    expect(transcriptLines[2].message.__openclaw).toBeUndefined();
    expect(transcriptLines[2].message.messageId).toBeUndefined();
    expect(transcriptLines[2].message.gatewayIndex).toBeUndefined();
    expect(await app.inject({ method: "POST", url: "/api/commands/middleware_chat_fork_history", payload: { input: { sessionKey: body.sessionKey } } }).then((r) => r.json())).toMatchObject({
      isFork: true,
      sourceSessionKey: "agent:main:desktop:source",
      sourceMessageId: "msg-2",
      messages: [{ text: "one" }, { text: "two" }],
    });
    const bootstrap = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(body.sessionKey)}` });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().messages).toMatchObject([{ text: "one" }, { text: "two" }]);
    await app.close();
  });

  test("treats gatewayIndex as OpenClaw sequence before falling back to array index", async () => {
    const app = await createApp(config("gateway-seq"));
    const context = contextOf(app);
    const transcriptPath = path.join(os.tmpdir(), `openclaw-fork-seq-${Date.now()}-${Math.random()}.jsonl`);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        return {
          sessionKey: payload?.sessionKey,
          messages: [
            { role: "user", text: "places in Gujarat", __openclaw: { id: "msg-28", seq: 28 } },
            { role: "assistant", text: "Best places to explore in Gujarat", __openclaw: { id: "msg-30", seq: 30 } },
            { role: "user", text: "How much gdp count in America", __openclaw: { id: "msg-31", seq: 31 } },
          ],
        };
      }
      if (method === "sessions.create") return { entry: { sessionFile: transcriptPath, sessionId: payload?.key } };
      return { ok: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: { input: { sessionKey: "s1", gatewayIndex: 30 } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().messages).toMatchObject([
      { text: "places in Gujarat" },
      { text: "Best places to explore in Gujarat" },
    ]);
    expect(res.json().messages).toHaveLength(2);
    await app.close();
  });

  test("does not use a misleading array index when message id is present", async () => {
    const app = await createApp(config("message-id-no-index-fallback"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        return {
          sessionKey: payload?.sessionKey,
          messages: [
            { role: "user", text: "places in Gujarat" },
            { role: "assistant", text: "Best places to explore in Gujarat" },
            { role: "user", text: "How much gdp count in America" },
          ],
        };
      }
      if (method === "sessions.create") throw new Error("sessions.create should not be called for unresolved fork point");
      return { ok: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: { input: { sessionKey: "s1", messageId: "ui-only-assistant-id", gatewayIndex: 2, role: "assistant" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false });
    await app.close();
  });

  test("returns a bad request when the fork point cannot be found", async () => {
    const app = await createApp(config("missing-message"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "request").mockResolvedValue({ sessionKey: "s1", messages: [{ role: "user", text: "hello", __openclaw: { id: "msg-1", seq: 1 } }] });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: { input: { sessionKey: "s1", messageId: "missing" } },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false });
    await app.close();
  });

  test("does not silently fall back for mistyped fork command names", async () => {
    const app = await createApp(config("mistyped-command"));

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork%5E",
      payload: { input: { sessionKey: "s1", messageId: "m1" } },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false });
    await app.close();
  });

  test("fails when Gateway does not return a transcript file for copied fork context", async () => {
    const app = await createApp(config("missing-transcript"));
    const context = contextOf(app);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        return { sessionKey: payload?.sessionKey, messages: [{ role: "assistant", text: "source", __openclaw: { id: "msg-1", seq: 1 } }] };
      }
      if (method === "sessions.create") return { ok: true };
      return { ok: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: { input: { sessionKey: "s1", messageId: "msg-1", gatewayIndex: 0 } },
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ ok: false, error: { message: "sessions.create did not return entry.sessionFile" } });
    await app.close();
  });

  test("preserves project topic context when forking from a topic chat", async () => {
    const app = await createApp(config("topic-context"));
    const context = contextOf(app);
    const sourceSessionKey = "agent:main:desktop:topic-source";
    const transcriptPath = path.join(os.tmpdir(), `openclaw-fork-topic-${Date.now()}-${Math.random()}.jsonl`);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        return {
          sessionKey: payload?.sessionKey,
          messages: [
            { role: "user", text: "topic context", __openclaw: { id: "msg-1", seq: 1 } },
            { role: "assistant", text: "answer", __openclaw: { id: "msg-2", seq: 2 } },
          ],
        };
      }
      if (method === "sessions.create") return { entry: { sessionFile: transcriptPath, sessionId: payload?.key } };
      return { ok: true };
    });

    await app.inject({ method: "POST", url: "/api/topics", payload: { id: "topic_source", projectId: "project_1", name: "Source topic" } });
    await app.inject({ method: "POST", url: "/api/sessions", payload: { sessionKey: sourceSessionKey, projectId: "project_1", topicId: "topic_source", agentId: "main", label: "Source topic" } });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: {
        input: {
          sessionKey: sourceSessionKey,
          messageId: "msg-2",
          gatewayIndex: 1,
          context: { type: "topic", projectId: "project_1", topicId: "topic_source", topicName: "Source topic" },
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, projectId: "project_1" });
    expect(body.topicId).toMatch(/^topic_/);
    expect(body.chatId).toBeNull();

    const sessions = await app.inject({ method: "GET", url: `/api/sessions?projectId=project_1&topicId=${encodeURIComponent(body.topicId)}` });
    expect(sessions.json().sessions).toMatchObject([{ sessionKey: body.sessionKey, projectId: "project_1", topicId: body.topicId }]);
    const topics = await app.inject({ method: "GET", url: "/api/topics?projectId=project_1" });
    expect(topics.json().topics.some((topic: { id: string }) => topic.id === body.topicId)).toBe(true);
    await app.close();
  });
});
