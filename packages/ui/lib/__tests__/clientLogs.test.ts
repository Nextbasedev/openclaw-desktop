import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  __clientLogsForTests,
  clearFrontendLogs,
  getFrontendEntries,
  redactText,
  sanitizeForLog,
  sanitizeUrlForLog,
} from "../clientLogs"
import { middlewareFetch } from "../middleware-client"

describe("client frontend logging safety", () => {
  beforeEach(() => {
    clearFrontendLogs()
    vi.restoreAllMocks()
  })

  it("redacts common secrets from text and URLs", () => {
    expect(redactText("Authorization: Bearer abc.def.ghi")).toContain("[redacted]")
    expect(redactText("https://x.test/path?token=secret&ok=1")).toContain("token=[redacted]")
    expect(sanitizeUrlForLog("https://x.test/api/chat/bootstrap?sessionKey=agent:main:a&token=secret")).toBe(
      "https://x.test/api/chat/bootstrap?sessionKey=…",
    )
  })

  it("omits message bodies while keeping attachment metadata", () => {
    const sanitized = sanitizeForLog({
      text: "do not log this user message",
      token: "secret-token",
      attachments: [{ name: "a.txt", mimeType: "text/plain", size: 12, content: "file content" }],
    }) as Record<string, unknown>

    expect(sanitized.text).toBe("[omitted]")
    expect(sanitized.token).toBe("[redacted]")
    expect(JSON.stringify(sanitized)).not.toContain("do not log this user message")
    expect(JSON.stringify(sanitized)).not.toContain("file content")
    expect(JSON.stringify(sanitized)).toContain("a.txt")
  })

  it("summarizes request bodies without user content", () => {
    const meta = __clientLogsForTests.requestMeta("https://x.test/api/chat/send?token=secret", {
      method: "POST",
      headers: { Authorization: "Bearer abc", "X-Debug": "yes" },
      body: JSON.stringify({ text: "private prompt", sessionKey: "s1", attachments: [{ name: "a.png", mimeType: "image/png", size: 4, content: "base64" }] }),
    })

    expect(meta.safeUrl).toBe("https://x.test/api/chat/send")
    expect(JSON.stringify(meta)).not.toContain("private prompt")
    expect(JSON.stringify(meta)).not.toContain("Bearer abc")
    expect(JSON.stringify(meta)).not.toContain("base64")
    expect(JSON.stringify(meta)).toContain("a.png")
  })

  it("middleware request logging records status without leaking auth", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "Invalid token abc" } }), { status: 401, statusText: "Unauthorized" })))

    await expect(
      middlewareFetch("/api/version?token=secret", {}, { url: "https://mw.test", token: "abc" }),
    ).rejects.toThrow("Invalid token abc")

    const text = getFrontendEntries().map((entry) => entry.message).join("\n")
    expect(text).toContain("middleware.fetch.start")
    expect(text).toContain("middleware.fetch.fail")
    expect(text).toContain("status")
    expect(text).not.toContain("Bearer abc")
    expect(text).not.toContain("token=secret")
  })

  it("treats optional cron SSE startup failures as unavailable warnings", () => {
    const url = "http://100.123.218.30:8787/api/stream/cron"

    expect(__clientLogsForTests.isOptionalSseStream(url)).toBe(true)
    expect(
      __clientLogsForTests.eventSourceEventName(2, false, false, url),
    ).toBe("sse.unavailable")
    expect(
      __clientLogsForTests.eventSourceErrorLevel(2, false, false, url),
    ).toBe("warn")
  })
})


it("redacts tauri invoke headers from request metadata", () => {
  const meta = __clientLogsForTests.requestMeta("http://ipc.localhost/plugin%3Aevent%7Clisten", {
    method: "POST",
    headers: {
      "tauri-invoke-key": "secret-ish",
      "tauri-callback": "123",
      "content-type": "application/json",
    },
  })
  expect(meta.headers?.["tauri-invoke-key"]).toBe("[redacted]")
  expect(meta.headers?.["tauri-callback"]).toBe("[redacted]")
  expect(meta.headers?.["content-type"]).toBe("application/json")
  expect(JSON.stringify(meta)).not.toContain("secret-ish")
})
