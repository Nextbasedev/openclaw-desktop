import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import { loadEnv, type MiddlewareV2Config } from "../src/config/env.js";

const config: MiddlewareV2Config = {
  host: "127.0.0.1",
  port: 8989,
  databasePath: "/tmp/openclaw-middleware-v2-test.sqlite",
  openclawGatewayUrl: "ws://127.0.0.1:18789",
  nodeEnv: "test",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware-v2 app", () => {
  test("defaults to the legacy middleware port", () => {
    expect(loadEnv({ HOME: "/tmp/openclaw-test" } as NodeJS.ProcessEnv).port).toBe(8787);
  });

  test("health returns service metadata", async () => {
    const app = await createApp(config);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, service: "openclaw-middleware-v2" });
    await app.close();
  });

  test("system info exposes configured v2 port", async () => {
    const app = await createApp(config);
    const res = await app.inject({ method: "GET", url: "/api/system/info" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, port: 8989 });
    await app.close();
  });

  test("chat bootstrap validates sessionKey", async () => {
    const app = await createApp(config);
    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: { code: "INVALID_QUERY" } });
    await app.close();
  });

  test("logs request lifecycle without query strings", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const app = await createApp(config);
    const res = await app.inject({ method: "GET", url: "/api/system/info?token=secret&sessionKey=s1" });
    expect(res.statusCode).toBe(200);
    const output = spy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("request.start");
    expect(output).toContain("request.end");
    expect(output).toContain("/api/system/info");
    expect(output).not.toContain("token=secret");
    await app.close();
  });
});
