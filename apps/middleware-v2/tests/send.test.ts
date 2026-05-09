import os from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareV2Config } from "../src/config/env.js";

function config(name: string): MiddlewareV2Config {
  return {
    host: "127.0.0.1",
    port: 8989,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-send-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

describe("chat send routes", () => {
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
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      return method === "chat.send" ? { runId: "r1" } : { ok: true };
    });
    const res = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: "s1", text: "hello", idempotencyKey: "stable-key", clientMessageId: "client-ui-1" },
    });
    expect(res.statusCode).toBe(200);
    expect(context.chatLive.diagnostics().optimisticUserSessions).toBe(1);
    expect(patches[0]).toMatchObject({
      type: "chat.message.upsert",
      sessionKey: "s1",
      payload: {
        optimistic: true,
        idempotencyKey: "stable-key",
        message: {
          role: "user",
          text: "hello",
          isOptimistic: true,
          __clientOptimistic: true,
          __openclaw: { id: "client-ui-1" },
        },
      },
    });
    await app.close();
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
