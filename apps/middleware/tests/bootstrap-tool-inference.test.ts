import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-tool-infer-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

describe("single-pass bootstrap tool inference", () => {
  test("pairs tool calls with id-matched results and detects errors", async () => {
    const app = await createApp(config("pairing"));
    const context = contextOf(app);
    const history = {
      sessionId: "sid",
      sessionFile: null,
      status: "done",
      messages: [
        { role: "user", content: [{ type: "text", text: "go" }], __openclaw: { id: "u1", seq: 1 } },
        { role: "assistant", content: [{ type: "toolCall", id: "t-ok", name: "search", arguments: { q: "a" } }], __openclaw: { id: "a1", seq: 2 } },
        { role: "tool", toolCallId: "t-ok", content: "found 3 results", __openclaw: { id: "r1", seq: 3 } },
        { role: "assistant", content: [{ type: "toolCall", id: "t-err", name: "fetch", arguments: { url: "x" } }], __openclaw: { id: "a2", seq: 4 } },
        { role: "tool", toolCallId: "t-err", content: { error: "boom" }, __openclaw: { id: "r2", seq: 5 } },
        { role: "assistant", content: [{ type: "text", text: "all done" }], __openclaw: { id: "a3", seq: 6 } },
      ],
    };
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") return history as unknown as Record<string, unknown>;
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-infer" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tools: Array<{ toolCallId: string; name: string; status: string; phase: string }> };
    expect(body.tools).toEqual([]);
    expect(context.runs.getToolCall("s-infer", "t-ok")).toMatchObject({ name: "search", status: "success", phase: "result" });
    expect(context.runs.getToolCall("s-infer", "t-err")).toMatchObject({ name: "fetch", status: "error" });
    const detail = await app.inject({ method: "GET", url: "/api/chat/tool-detail?sessionKey=s-infer&ids=t-ok,t-err" });
    expect(detail.json().tools.map((t: { toolCallId: string }) => t.toolCallId)).toEqual(["t-ok", "t-err"]);
    await app.close();
  });

  test("falls back to success on completed sessions when a tool has no explicit result", async () => {
    const app = await createApp(config("fallback"));
    const context = contextOf(app);
    const history = {
      sessionId: "sid",
      sessionFile: null,
      status: "done",
      messages: [
        { role: "assistant", content: [{ type: "toolCall", id: "t-noresult", name: "noop", arguments: {} }], __openclaw: { id: "a1", seq: 1 } },
      ],
    };
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") return history as unknown as Record<string, unknown>;
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-fallback" });
    const body = res.json() as { tools: Array<{ toolCallId: string; status: string }> };
    expect(body.tools).toEqual([]);
    expect(context.runs.getToolCall("s-fallback", "t-noresult")?.status).toBe("success");
    await app.close();
  });
});
