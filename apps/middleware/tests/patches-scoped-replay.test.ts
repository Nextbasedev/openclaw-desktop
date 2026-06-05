import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return { host: "127.0.0.1", port: 8787, databasePath: path.join(os.tmpdir(), `oc-patches-${name}-${Date.now()}-${Math.random()}.sqlite`), openclawGatewayUrl: "ws://127.0.0.1:1", nodeEnv: "test" };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>) {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

describe("scoped patch replay", () => {
  test("/api/patches filters by sessionKey when provided and preserves unfiltered replay", async () => {
    const app = await createApp(config("http"));
    try {
      const context = contextOf(app);
      const a1 = context.messages.appendProjectionEvent({ sessionKey: "a", eventType: "chat.message.upsert", payload: { sessionKey: "a", n: 1 } });
      const b1 = context.messages.appendProjectionEvent({ sessionKey: "b", eventType: "chat.message.upsert", payload: { sessionKey: "b", n: 1 } });
      const a2 = context.messages.appendProjectionEvent({ sessionKey: "a", eventType: "chat.message.upsert", payload: { sessionKey: "a", n: 2 } });

      const scoped = await app.inject({ method: "GET", url: `/api/patches?afterCursor=${a1.cursor - 1}&sessionKey=a` });
      expect(scoped.statusCode).toBe(200);
      expect(scoped.json().patches.map((patch: { cursor: number; sessionKey: string }) => [patch.cursor, patch.sessionKey])).toEqual([[a1.cursor, "a"], [a2.cursor, "a"]]);

      const unfiltered = await app.inject({ method: "GET", url: `/api/patches?afterCursor=${a1.cursor - 1}` });
      expect(unfiltered.json().patches.map((patch: { cursor: number; sessionKey: string }) => [patch.cursor, patch.sessionKey])).toEqual([[a1.cursor, "a"], [b1.cursor, "b"], [a2.cursor, "a"]]);
    } finally {
      await app.close();
    }
  });
});
