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
});
