import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { isLivePlaceholderMessage, isVisibleMessage } from "../src/features/chat/message-normalizer.js";
import type { OCPlatformMessage, ProjectedMessage } from "../src/features/chat/types.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-live-placeholder-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

describe("live placeholder rows are filtered from /api/chat/messages (audit Bug 4)", () => {
  test("placeholder=true marker drops the row from the visible window", () => {
    const placeholder: OCPlatformMessage = {
      id: "live:run-1:assistant",
      role: "assistant",
      text: "streaming text",
      __openclaw: { id: "live:run-1:assistant", runId: "run-1", placeholder: true },
    };
    expect(isLivePlaceholderMessage(placeholder)).toBe(true);
    expect(isVisibleMessage(placeholder)).toBe(false);
  });

  test("id pattern `live:<runId>:assistant` alone is enough to mark the row hidden", () => {
    const placeholderByIdOnly: OCPlatformMessage = {
      id: "live:run-1:assistant",
      role: "assistant",
      text: "streaming text",
      __openclaw: { id: "live:run-1:assistant", runId: "run-1" },
    };
    expect(isLivePlaceholderMessage(placeholderByIdOnly)).toBe(true);
    expect(isVisibleMessage(placeholderByIdOnly)).toBe(false);
  });

  test("a regular assistant message with similar id pattern is NOT classified as placeholder", () => {
    const realAssistant: OCPlatformMessage = {
      id: "msg-1",
      role: "assistant",
      text: "real answer",
      __openclaw: { id: "msg-1", runId: "run-1" },
    };
    expect(isLivePlaceholderMessage(realAssistant)).toBe(false);
    expect(isVisibleMessage(realAssistant)).toBe(true);
  });

  test("persisted live placeholder row is NOT returned by /api/chat/messages", async () => {
    const app = await createApp(config("placeholder-filtered-from-read"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });

    // Simulate what broadcastLiveAssistantText does post-fix: persist a row
    // with the live:<runId>:assistant id AND placeholder=true flag.
    const placeholderRow: ProjectedMessage = {
      sessionKey: "s1",
      openclawSeq: 1,
      messageId: "live:run-1:assistant",
      role: "assistant",
      data: {
        id: "live:run-1:assistant",
        role: "assistant",
        text: "streaming...",
        __openclaw: { id: "live:run-1:assistant", runId: "run-1", placeholder: true },
      },
      updatedAtMs: 1000,
    };
    // Plus a real assistant message in the same session.
    const realRow: ProjectedMessage = {
      sessionKey: "s1",
      openclawSeq: 2,
      messageId: "msg-final",
      role: "assistant",
      data: {
        id: "msg-final",
        role: "assistant",
        text: "final answer",
        __openclaw: { id: "msg-final", runId: "run-1" },
      },
      updatedAtMs: 2000,
    };
    ctx.messages.upsertMessages([placeholderRow, realRow]);

    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages?sessionKey=s1&beforeSeq=999999&limit=50",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const ids = (body.messages as Array<{ messageId?: string | null }>).map((m) => m.messageId);
    expect(ids).toContain("msg-final");
    expect(ids).not.toContain("live:run-1:assistant");
    // The placeholder was scanned (we should see it in scannedCount) but not
    // visible.
    expect(body.visibleCount).toBe(1);
    expect(body.scannedCount).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  test("placeholder row is also filtered out of bootstrap-style listAllMessages reads", () => {
    const placeholder: OCPlatformMessage = {
      id: "live:run-2:assistant",
      role: "assistant",
      text: "streaming...",
      __openclaw: { id: "live:run-2:assistant", runId: "run-2", placeholder: true },
    };
    // The same predicate that the bootstrap route uses post-Commit 2.
    expect(isVisibleMessage(placeholder)).toBe(false);
  });
});
