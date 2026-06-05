import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";

function config(name: string): MiddlewareConfig {
  return { host: "127.0.0.1", port: 8787, databasePath: path.join(os.tmpdir(), `oc-session-head-${name}-${Date.now()}-${Math.random()}.sqlite`), openclawGatewayUrl: "ws://127.0.0.1:1", nodeEnv: "test" };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>) {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

describe("chat session head", () => {
  test("head cursor is scoped to the requested session and includes visible stats", async () => {
    const app = await createApp(config("scoped"));
    try {
      const context = contextOf(app);
      context.messages.upsertSession({ sessionKey: "a", sessionId: "sid-a", data: { sessionKey: "a" } });
      context.messages.upsertSession({ sessionKey: "b", sessionId: "sid-b", data: { sessionKey: "b" } });
      context.messages.upsertMessages([
        { sessionKey: "a", openclawSeq: 1, messageId: "a-u1", role: "user", data: { role: "user", text: "hello" }, updatedAtMs: 100 },
        { sessionKey: "a", openclawSeq: 2, messageId: "a-a1", role: "assistant", data: { role: "assistant", text: "hi" }, updatedAtMs: 101 },
      ]);
      const a1 = context.messages.appendProjectionEvent({ sessionKey: "a", eventType: "chat.message.upsert", payload: { sessionKey: "a" } });
      context.messages.appendProjectionEvent({ sessionKey: "b", eventType: "chat.message.upsert", payload: { sessionKey: "b" } });

      const res1 = await app.inject({ method: "GET", url: "/api/chat/session-head?sessionKey=a" });
      expect(res1.statusCode).toBe(200);
      expect(res1.json()).toEqual({ ok: true, sessionKey: "a", headCursor: a1.cursor, knownVisibleTotal: 2, oldestVisibleSeq: 1 });

      context.messages.appendProjectionEvent({ sessionKey: "b", eventType: "chat.message.upsert", payload: { sessionKey: "b", n: 2 } });
      const res2 = await app.inject({ method: "GET", url: "/api/chat/session-head?sessionKey=a" });
      expect(res2.json().headCursor).toBe(a1.cursor);
    } finally {
      await app.close();
    }
  });
});
