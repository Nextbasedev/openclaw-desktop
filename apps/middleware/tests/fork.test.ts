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
      { role: "assistant", text: "two", __openclaw: { id: "msg-2", seq: 2 } },
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
      payload: { input: { sessionKey: "agent:main:desktop:source", messageId: "msg-2", gatewayIndex: 1 } },
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
    expect(transcriptLines.slice(1)).toMatchObject([
      { type: "message", id: "msg-1", parentId: null, message: { role: "user", text: "one", content: "one" } },
      { type: "message", id: "msg-2", parentId: "msg-1", message: { role: "assistant", text: "two", content: "two" } },
    ]);
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

  test("prefers the selected message id over gatewayIndex array offsets", async () => {
    const app = await createApp(config("message-id-before-index"));
    const context = contextOf(app);
    const sourceMessages = [
      { role: "user", text: "first", __openclaw: { id: "msg-1", seq: 10 } },
      { role: "assistant", text: "first answer", __openclaw: { id: "msg-2", seq: 20 } },
      { role: "user", text: "next user should not be copied", __openclaw: { id: "msg-3", seq: 30 } },
    ];
    const transcriptPath = path.join(os.tmpdir(), `openclaw-fork-mid-${Date.now()}-${Math.random()}.jsonl`);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") return { sessionKey: payload?.sessionKey, messages: sourceMessages };
      if (method === "sessions.create") return { entry: { sessionFile: transcriptPath, sessionId: payload?.key } };
      return { ok: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: { input: { sessionKey: "agent:main:desktop:source", messageId: "msg-2", gatewayIndex: 2 } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().messages.map((message: { text: string }) => message.text)).toEqual(["first", "first answer"]);
    await app.close();
  });

  test("uses gatewayIndex as transcript sequence, not history array offset", async () => {
    const app = await createApp(config("gateway-index-seq"));
    const context = contextOf(app);
    const sourceMessages = [
      { role: "user", text: "first", __openclaw: { id: "msg-10", seq: 10 } },
      { role: "assistant", text: "first answer", __openclaw: { id: "msg-20", seq: 20 } },
      { role: "user", text: "next user should not be copied", __openclaw: { id: "msg-30", seq: 30 } },
    ];
    const transcriptPath = path.join(os.tmpdir(), `openclaw-fork-seq-${Date.now()}-${Math.random()}.jsonl`);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") return { sessionKey: payload?.sessionKey, messages: sourceMessages };
      if (method === "sessions.create") return { entry: { sessionFile: transcriptPath, sessionId: payload?.key } };
      return { ok: true };
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/commands/middleware_chat_fork",
      payload: { input: { sessionKey: "agent:main:desktop:source", gatewayIndex: 20 } },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().messages.map((message: { text: string }) => message.text)).toEqual(["first", "first answer"]);
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
