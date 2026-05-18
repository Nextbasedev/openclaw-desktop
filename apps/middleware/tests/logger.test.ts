import { afterEach, describe, expect, test, vi } from "vitest";
import { createLogger, redactErrorMessage, redactLogValue, safePathFromUrl, safeUrlForLog } from "../src/lib/logger.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("middleware logger redaction", () => {
  test("redacts secrets and message content before writing logs", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    createLogger("test").info("event", {
      authorization: "Bearer secret-token",
      cookie: "sid=secret",
      apiKey: "secret-api-key",
      sessionKey: "session-safe-id",
      message: "do not log user words",
      nested: { content: "file contents", ok: true },
    });

    const line = String(spy.mock.calls[0]?.[0] ?? "");
    expect(line).toContain("[mw:test] event");
    expect(line).toContain("session-safe-id");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("secret-api-key");
    expect(line).not.toContain("do not log user words");
    expect(line).not.toContain("file contents");
    expect(line).toContain("[redacted]");
  });

  test("redacts token-like error messages and strips query strings from URLs", () => {
    expect(redactErrorMessage("failed token=abc123 sk-ant-api-secret")).toBe("failed token=[redacted] [redacted]");
    expect(redactLogValue({ text: "hello", safe: "ok" })).toEqual({ text: "[redacted]", safe: "ok" });
    expect(safePathFromUrl("/api/chat/bootstrap?sessionKey=s1&token=secret")).toBe("/api/chat/bootstrap");
    expect(safeUrlForLog("ws://localhost:18789/connect?token=secret")).toBe("ws://localhost:18789/connect");
  });
});
