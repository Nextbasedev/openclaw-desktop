import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function testConfig(overrides: Partial<MiddlewareConfig> = {}): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-telegram-discovery-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:1",
    nodeEnv: "test",
    ...overrides,
  };
}

function telegramLine(groupId: string, topicId: string, topicName: string, text = "message") {
  const meta = JSON.stringify({
    chat_id: `telegram:${groupId}`,
    topic_id: topicId,
    group_subject: "Group",
    topic_name: topicName,
    is_group_chat: true,
  });
  return JSON.stringify({
    type: "message",
    id: `${groupId}-${topicId}`,
    timestamp: "2026-07-13T00:00:00.000Z",
    message: { role: "user", content: `Conversation info (untrusted metadata):\n\`\`\`json\n${meta}\n\`\`\`\n\n${text}` },
  });
}

function setupSessionsHome(prefix = "openclaw-telegram-discovery-") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  vi.spyOn(os, "homedir").mockReturnValue(home);
  const sessionsDir = path.join(home, ".openclaw", "agents", "main", "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  return { home, sessionsDir };
}

afterEach(() => vi.restoreAllMocks());

describe("Telegram migration discovery", () => {
  test("paginates advertised Gateway cursors, deduplicates source keys, and applies the limit after stable sorting", async () => {
    setupSessionsHome();
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      if (!params.cursor) {
        return {
          sessions: [
            { key: "agent:main:telegram:group:-1001:topic:10", updatedAt: "2026-07-10T00:00:00.000Z" },
            { key: "agent:main:telegram:group:-1001:topic:20", updatedAt: "2026-07-11T00:00:00.000Z" },
          ],
          nextCursor: "page-2",
        };
      }
      expect(params.cursor).toBe("page-2");
      return {
        sessions: [
          { key: "agent:main:telegram:group:-1001:topic:10", updatedAt: "2026-07-12T00:00:00.000Z" },
          { key: "agent:main:telegram:group:-1001:topic:30", updatedAt: "2026-07-12T00:00:00.000Z" },
        ],
      };
    });

    const response = await app.inject({ method: "GET", url: "/api/migration/telegram/scan?limit=2" });

    expect(response.statusCode).toBe(200);
    expect(context.gateway.request).toHaveBeenCalledTimes(2);
    expect(response.json().sessions.map((session: { sourceSessionKey: string }) => session.sourceSessionKey)).toEqual([
      "agent:main:telegram:group:-1001:topic:10",
      "agent:main:telegram:group:-1001:topic:30",
    ]);
    expect(response.json().diagnostics.sources.gateway).toMatchObject({ status: "complete", pages: 2, accepted: 3 });
    await app.close();
  });

  test("discovers nested and non-topic transcripts by metadata or exact index association, and reports rejected files", async () => {
    const { sessionsDir } = setupSessionsHome();
    const nested = path.join(sessionsDir, "archive", "nested");
    fs.mkdirSync(nested, { recursive: true });
    const metadataWins = path.join(nested, "topic-999.jsonl");
    const nonTopic = path.join(nested, "conversation-export.jsonl");
    const indexed = path.join(nested, "not-a-topic.jsonl");
    const rejected = path.join(nested, "unrelated.jsonl");
    fs.writeFileSync(metadataWins, `${telegramLine("-1001", "42", "Metadata wins")}\n`);
    fs.writeFileSync(nonTopic, `${telegramLine("-1001", "43", "Nested export")}\n`);
    fs.writeFileSync(indexed, `${JSON.stringify({ type: "message", id: "plain", message: { role: "user", content: "No Telegram metadata" } })}\n`);
    fs.writeFileSync(rejected, `${JSON.stringify({ type: "message", id: "unrelated", message: { role: "user", content: "No useful metadata" } })}\n`);
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({
      "agent:main:telegram:group:-1001:topic:44": { sessionFile: indexed },
    }));

    const app = await createApp(testConfig());
    const response = await app.inject({ method: "GET", url: "/api/migration/telegram/scan?includeGateway=false" });

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions.map((session: { sourceSessionKey: string }) => session.sourceSessionKey).sort()).toEqual([
      "agent:main:telegram:group:-1001:topic:42",
      "agent:main:telegram:group:-1001:topic:43",
      "agent:main:telegram:group:-1001:topic:44",
    ]);
    expect(response.json().diagnostics.sources.transcripts).toMatchObject({ candidates: 4, accepted: 3, rejected: 1 });
    expect(response.json().diagnostics.partialFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "transcripts", code: "unidentified_transcript", path: rejected }),
    ]));
    await app.close();
  });

  test("invalidates transcript discovery only when that agent/root snapshot changes", async () => {
    const { sessionsDir } = setupSessionsHome();
    const first = path.join(sessionsDir, "first.jsonl");
    fs.writeFileSync(first, `${telegramLine("-1001", "42", "First")}\n`);
    const app = await createApp(testConfig());

    const initial = await app.inject({ method: "GET", url: "/api/migration/telegram/scan?includeGateway=false" });
    expect(initial.json().sessions).toHaveLength(1);

    const second = path.join(sessionsDir, "archive", "new", "second.jsonl");
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.writeFileSync(second, `${telegramLine("-1001", "43", "Second")}\n`);
    const refreshed = await app.inject({ method: "GET", url: "/api/migration/telegram/scan?includeGateway=false" });

    expect(refreshed.json().sessions.map((session: { sourceSessionKey: string }) => session.sourceSessionKey).sort()).toEqual([
      "agent:main:telegram:group:-1001:topic:42",
      "agent:main:telegram:group:-1001:topic:43",
    ]);
    await app.close();
  });

  test("retains completed sources and reports a partial Gateway pagination failure", async () => {
    const { sessionsDir } = setupSessionsHome();
    const diskKey = "agent:main:telegram:group:-1001:topic:42";
    fs.writeFileSync(path.join(sessionsDir, "sessions.json"), JSON.stringify({ [diskKey]: {} }));
    const app = await createApp(testConfig());
    const context = (app as typeof app & { v2Context: { gateway: { status: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn> } } }).v2Context;
    context.gateway.status = vi.fn(() => ({ connected: true, lastError: null }));
    context.gateway.request = vi.fn(async (_method: string, params: Record<string, unknown>) => {
      if (!params.cursor) return { sessions: [{ key: "agent:main:telegram:group:-1001:topic:43" }], nextCursor: "page-2" };
      throw new Error("Gateway temporarily unavailable");
    });

    const response = await app.inject({ method: "GET", url: "/api/migration/telegram/scan" });

    expect(response.statusCode).toBe(200);
    expect(response.json().sessions.map((session: { sourceSessionKey: string }) => session.sourceSessionKey).sort()).toEqual([
      diskKey,
      "agent:main:telegram:group:-1001:topic:43",
    ]);
    expect(response.json().diagnostics.sources.gateway).toMatchObject({ status: "partial", pages: 1 });
    expect(response.json().diagnostics.partialFailures).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: "gateway", code: "gateway_page_failed", cursor: "page-2" }),
    ]));
    await app.close();
  });
});
