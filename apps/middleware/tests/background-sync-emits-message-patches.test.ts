import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { allowLocalFirstSqliteForTests, clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";

function config(name: string): MiddlewareConfig {
  return { host: "127.0.0.1", port: 8787, databasePath: path.join(os.tmpdir(), `oc-bg-sync-${name}-${Date.now()}-${Math.random()}.sqlite`), openclawGatewayUrl: "ws://127.0.0.1:1", nodeEnv: "test" };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>) {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

async function waitFor(condition: () => boolean, timeoutMs = 1000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

describe("background Gateway reconcile", () => {
  test("routine sync emits chat.message patches with monotonic seq, not chat.bootstrap, and does not duplicate rows", async () => {
    const app = await createApp(config("message-patches"));
    try {
      allowLocalFirstSqliteForTests();
      const context = contextOf(app);
      const old = Date.now() - 10 * 60 * 1000;
      context.messages.upsertSession({ sessionKey: "s1", sessionId: "sid", data: { sessionKey: "s1", status: "done" }, updatedAtMs: old });
      context.messages.upsertMessages([{ sessionKey: "s1", openclawSeq: 1, messageId: "u1", role: "user", data: { role: "user", text: "hello", __openclaw: { id: "u1", seq: 1 } }, updatedAtMs: old }]);
      vi.spyOn(context.gateway, "status").mockReturnValue({ connected: true, gatewayUrl: "ws://127.0.0.1:1", connectedAtMs: old, lastError: null, pendingRequests: 0, listenerCount: 0 });
      vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
        if (method === "chat.history") {
          return {
            sessionKey: "s1",
            sessionId: "sid",
            status: "done",
            messages: [
              { role: "user", content: "hello", __openclaw: { id: "u1", seq: 1 } },
              { role: "assistant", content: "world", __openclaw: { id: "a1", seq: 2 } },
            ],
          } as never;
        }
        return { ok: true } as never;
      });

      const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1&limit=10" });
      expect(bootstrap.statusCode).toBe(200);
      await waitFor(() => {
        const rows = context.db.prepare("SELECT payload_json FROM v2_projection_events WHERE session_key = 's1'").all() as Array<{ payload_json: string }>;
        return rows.some((event) => JSON.parse(event.payload_json).backgroundRefresh === true);
      });

      const events = context.db.prepare("SELECT cursor, event_type, payload_json FROM v2_projection_events WHERE session_key = 's1' ORDER BY cursor ASC").all() as Array<{ cursor: number; event_type: string; payload_json: string }>;
      const backgroundEvents = events.filter((event) => JSON.parse(event.payload_json).backgroundRefresh === true);
      expect(backgroundEvents.map((event) => event.event_type)).toEqual(backgroundEvents.map(() => "chat.message.upsert"));
      expect(backgroundEvents.map((event) => event.event_type)).not.toContain("chat.bootstrap");
      const assistantEvent = backgroundEvents.find((event) => JSON.parse(event.payload_json).messageSeq === 2);
      expect(JSON.parse(assistantEvent!.payload_json)).toMatchObject({ messageSeq: 2, lastSeq: 2, message: { messageId: "a1" } });
      expect(context.messages.listMessages("s1").map((message) => message.messageId)).toEqual(["u1", "a1"]);
    } finally {
      await app.close();
    }
  });
});
