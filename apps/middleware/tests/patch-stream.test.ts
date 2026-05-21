import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { afterEach, describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { listPatchesAfter } from "../src/features/patches.js";

const apps: Array<Awaited<ReturnType<typeof createApp>>> = [];

afterEach(async () => {
  while (apps.length) {
    await apps.pop()?.close();
  }
});

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-patch-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for websocket message")), 5000);
    ws.once("message", (raw) => {
      clearTimeout(timer);
      try { resolve(JSON.parse(raw.toString())); } catch (error) { reject(error); }
    });
    ws.once("error", reject);
  });
}

describe("patch stream", () => {
  test("cron SSE stream emits ready event and closes cleanly", async () => {
    const app = await createApp(config("cron-sse"));
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${address.port}/api/stream/cron`, { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") || "").toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("missing cron SSE reader");
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timeout waiting for cron.ready")), 5_000);
        timeout.unref?.();
      }),
    ]);
    if (timeout) clearTimeout(timeout);
    const text = new TextDecoder().decode(first.value);
    expect(text).toContain("event: cron.ready");
    controller.abort();
    await reader.cancel().catch(() => undefined);
  });

  test("listPatchesAfter replays only newer projection events", async () => {
    const app = await createApp(config("replay"));
    apps.push(app);
    const context = contextOf(app);
    const first = context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "one", payload: { n: 1 } });
    const second = context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "two", payload: { n: 2 } });
    const patches = listPatchesAfter(context, first.cursor);
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({ cursor: second.cursor, type: "two", sessionKey: "s1" });
  });

  test("/api/patches returns latestCursor and hasMore", async () => {
    const app = await createApp(config("api"));
    apps.push(app);
    const context = contextOf(app);
    context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "one", payload: { n: 1 } });
    context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "two", payload: { n: 2 } });
    const res = await app.inject({ method: "GET", url: "/api/patches?afterCursor=0&limit=1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, count: 1, hasMore: true, replayWindowExceeded: true, recovery: "bootstrap" });
    expect(body.latestCursor).toBeGreaterThan(0);
  });

  test("websocket marks replayHasMore when stale cursor exceeds replay window", async () => {
    const app = await createApp(config("stale-ws"));
    apps.push(app);
    const context = contextOf(app);
    for (let i = 0; i < 1001; i++) {
      context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "chat.message.upsert", payload: { n: i } });
    }
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/stream/ws?afterCursor=0`);
    const hello = await waitForMessage(ws);
    expect(hello).toMatchObject({ type: "hello", replayCount: 1000, replayHasMore: true, replayWindowExceeded: true, recovery: "bootstrap" });
    ws.close();
  });

  test("websocket opens and registers a patch client", async () => {
    const app = await createApp(config("ws"));
    apps.push(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/stream/ws?afterCursor=0`);
    const hello = await waitForMessage(ws);
    expect(hello).toMatchObject({ type: "hello", replayCount: 0 });
    const diag = await app.inject({ method: "GET", url: "/api/diagnostics/patch-clients" });
    expect(diag.json().patchBus.clients).toBe(1);
    ws.close();
  });

  test("broadcast sends new patches to connected websocket clients", async () => {
    const app = await createApp(config("broadcast"));
    apps.push(app);
    const context = contextOf(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/api/stream/ws?afterCursor=0`);
    const hello = await waitForMessage(ws);
    expect(hello).toMatchObject({ type: "hello" });
    const event = context.messages.appendProjectionEvent({ sessionKey: "s1", eventType: "chat.message.upsert", payload: { n: 1 } });
    context.patchBus.broadcast({
      cursor: event.cursor,
      type: event.eventType,
      sessionKey: event.sessionKey,
      payload: event.payload,
      createdAtMs: event.createdAtMs,
    });
    const patch = await waitForMessage(ws);
    expect(patch).toMatchObject({ type: "patch", patch: { cursor: event.cursor, type: "chat.message.upsert" } });
    ws.close();
  });
});
