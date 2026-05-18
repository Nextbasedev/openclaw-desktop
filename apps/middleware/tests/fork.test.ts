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
      // gatewayIndex is intentionally wrong here; fork must prefer the stable
      // selected message id so UI/raw-history index drift cannot copy the wrong
      // context into the branch.
      payload: { input: { sessionKey: "agent:main:desktop:source", messageId: "msg-2", gatewayIndex: 0 } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, sourceSessionKey: "agent:main:desktop:source", sourceMessageId: "msg-2" });
    expect(body.sessionKey).toMatch(/^agent:main:desktop:fork-/);
    expect(body.messages).toHaveLength(2);
    const createPayload = calls.find((call) => call.method === "sessions.create")?.payload;
    expect(createPayload).toMatchObject({
      key: body.sessionKey,
      agentId: "main",
    });
    expect(createPayload).not.toHaveProperty("parentSessionKey");
    const transcriptLines = fs.readFileSync(transcriptPath, "utf8").trim().split(/\r?\n/).map((line) => JSON.parse(line));
    expect(transcriptLines).toMatchObject([
      { type: "session" },
      { type: "message", id: "msg-1", parentId: null, message: { role: "user", text: "one" } },
      { type: "message", id: "msg-2", parentId: "msg-1", message: { role: "assistant", text: "two" } },
    ]);
    expect(transcriptLines[1].message.__openclaw).toBeUndefined();
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
});
