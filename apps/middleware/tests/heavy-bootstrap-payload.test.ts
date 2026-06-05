import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { allowLocalFirstSqliteForTests, clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-heavy-payload-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function seedToolSession(context: AppContext, sessionKey: string, count = 2, bodySize = 4_000) {
  allowLocalFirstSqliteForTests();
  vi.spyOn(context.gateway, "status").mockReturnValue({
    connected: true,
    gatewayUrl: "ws://127.0.0.1:18789",
    connectedAtMs: Date.now(),
    lastError: null,
    pendingRequests: 0,
    listenerCount: 0,
  });
  context.messages.upsertSession({ sessionKey, sessionId: "sid", data: { sessionKey, sessionId: "sid", status: "done" }, updatedAtMs: Date.now() });
  const segment = context.messages.ensureActiveSegment({ sessionKey, sessionId: "sid" });
  context.runs.upsertRun({ runId: "run-old", sessionKey, status: "done", startedAtMs: 100, updatedAtMs: 200 });
  context.runs.upsertRun({ runId: "run-recent", sessionKey, status: "done", startedAtMs: 1_000, updatedAtMs: 2_000 });

  const messages: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i += 1) {
    const oldBody = `OLD_SENTINEL_${i}_` + "x".repeat(bodySize);
    const recentBody = `RECENT_SENTINEL_${i}_` + "y".repeat(bodySize);
    context.runs.upsertToolCall({
      sessionKey,
      runId: "run-old",
      toolCallId: `old-${i}`,
      name: "read",
      phase: "result",
      status: "success",
      argsMeta: { q: oldBody },
      resultMeta: { out: oldBody },
      startedAtMs: 100 + i,
      finishedAtMs: 150 + i,
      updatedAtMs: 200 + i,
    });
    if (i === 0) {
      context.runs.upsertToolCall({
        sessionKey,
        runId: "run-recent",
        toolCallId: "recent-0",
        name: "write",
        phase: "result",
        status: "success",
        argsMeta: { q: recentBody },
        resultMeta: { out: recentBody },
        startedAtMs: 1_000,
        finishedAtMs: 1_500,
        updatedAtMs: 2_000,
      });
    }
    messages.push({
      role: "assistant",
      content: [
        { type: "text", text: `old text ${i}` },
        { type: "tool_use", id: `old-${i}`, name: "read", input: { q: oldBody } },
        { type: "tool_result", tool_use_id: `old-${i}`, content: { out: oldBody } },
      ],
      __openclaw: { id: `m-old-${i}`, seq: i + 1, runId: "run-old" },
    });
  }
  messages.push({
    role: "assistant",
    content: [
      { type: "text", text: "recent text" },
      { type: "tool_use", id: "recent-0", name: "write", input: { q: "RECENT_SENTINEL_0_" + "y".repeat(bodySize) } },
    ],
    __openclaw: { id: "m-recent", seq: count + 1, runId: "run-recent" },
  });
  context.messages.upsertMessages(normalizeHistoryMessages(sessionKey, messages), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
}

async function seededApp(name: string, count?: number, bodySize?: number) {
  const app = await createApp(config(name));
  const context = contextOf(app);
  seedToolSession(context, "s-heavy", count, bodySize);
  return { app, context };
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

describe("heavy chat payload contract", () => {
  test("bootstrap strips historical tool bodies and keeps latest-run tool bodies", async () => {
    const { app } = await seededApp("bootstrap");
    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-heavy" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const text = res.body;
    expect(text).not.toContain("OLD_SENTINEL_0_" + "x".repeat(1000));
    expect(text).toContain("RECENT_SENTINEL_0_");

    const oldTool = body.toolCalls.find((tool: { toolCallId: string }) => tool.toolCallId === "old-0");
    expect(oldTool).toMatchObject({ toolCallId: "old-0", name: "read", status: "success", phase: "result", detailTruncated: true });
    expect(oldTool).not.toHaveProperty("argsMeta");
    expect(oldTool).not.toHaveProperty("resultMeta");

    const recentTool = body.toolCalls.find((tool: { toolCallId: string }) => tool.toolCallId === "recent-0");
    expect(recentTool.argsMeta.q).toContain("RECENT_SENTINEL_0_");
    expect(recentTool.resultMeta.out).toContain("RECENT_SENTINEL_0_");

    const oldMessage = body.messages.find((message: { messageId?: string }) => message.messageId === "m-old-0");
    const oldUse = oldMessage.content.find((block: { toolCallId?: string }) => block.toolCallId === "old-0");
    expect(oldUse).toMatchObject({ toolCallId: "old-0", name: "read", detailTruncated: true });
    expect(oldUse).not.toHaveProperty("input");
    await app.close();
  });

  test("older-page route strips historical tool bodies identically", async () => {
    const { app } = await seededApp("older");
    const res = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s-heavy&beforeSeq=2&limit=1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain("OLD_SENTINEL_0_" + "x".repeat(1000));
    const first = res.json().messages[0].data;
    const oldUse = first.content.find((block: { toolCallId?: string }) => block.toolCallId === "old-0");
    expect(oldUse).toMatchObject({ detailTruncated: true, toolCallId: "old-0" });
    expect(oldUse).not.toHaveProperty("input");
    await app.close();
  });

  test("tool-detail returns full args/results and rejects more than 50 ids", async () => {
    const { app } = await seededApp("detail");
    const res = await app.inject({ method: "GET", url: "/api/chat/tool-detail?sessionKey=s-heavy&ids=old-0,missing,recent-0" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, sessionKey: "s-heavy" });
    expect(body.tools.map((tool: { toolCallId: string }) => tool.toolCallId)).toEqual(["old-0", "recent-0"]);
    expect(body.tools[0].argsMeta.q).toContain("OLD_SENTINEL_0_");
    expect(body.tools[0].resultMeta.out).toContain("OLD_SENTINEL_0_");

    const tooMany = Array.from({ length: 51 }, (_, i) => `id-${i}`).join(",");
    const bad = await app.inject({ method: "GET", url: `/api/chat/tool-detail?sessionKey=s-heavy&ids=${tooMany}` });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });

  test("synthetic tool-dense bootstrap response is dramatically smaller", async () => {
    const bodySize = 10_000;
    const count = 30;
    const { app } = await seededApp("size", count, bodySize);
    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-heavy" });
    expect(res.statusCode).toBe(200);
    const unstrippedLowerBound = count * bodySize * 4;
    expect(res.body.length).toBeLessThan(unstrippedLowerBound / 5);
    expect(res.body).not.toContain("OLD_SENTINEL_29_" + "x".repeat(1000));
    expect(res.body).toContain("RECENT_SENTINEL_0_");
    await app.close();
  });
});
