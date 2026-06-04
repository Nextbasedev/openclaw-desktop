import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CHAT_PROJECTION_VERSION, chatProjectionResyncRequiredMetaKey } from "../src/db/chat-projection-version.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
import { allowLocalFirstSqliteForTests, clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-bootstrap-dedupe-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

async function waitFor(condition: () => boolean, timeoutMs = 500) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Synthetic history: many assistant turns with tool calls + matching tool results. */
function syntheticHistory(messageCount: number, toolEvery: number) {
  const messages: Record<string, unknown>[] = [];
  let seq = 1;
  for (let i = 0; i < messageCount; i += 1) {
    const id = `m${i}`;
    if (i % toolEvery === 0) {
      const toolCallId = `tool-${i}`;
      messages.push({
        role: "assistant",
        content: [{ type: "toolCall", id: toolCallId, name: "do_thing", arguments: { i } }],
        __openclaw: { id, seq: seq++ },
      });
      messages.push({
        role: "tool",
        toolCallId,
        content: `result ${i}`,
        __openclaw: { id: `${id}-r`, seq: seq++ },
      });
    } else {
      messages.push({ role: i % 2 === 0 ? "user" : "assistant", content: [{ type: "text", text: `msg ${i}` }], __openclaw: { id, seq: seq++ } });
    }
  }
  return { sessionId: "sid-1", sessionFile: null, status: "done", messages };
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

describe("cold bootstrap in-flight dedupe", () => {
  test("collapses N concurrent cold bootstraps into a single chat.history fetch", async () => {
    const app = await createApp(config("dedupe"));
    const context = contextOf(app);
    const history = syntheticHistory(400, 5); // ~80 tool calls

    let historyCalls = 0;
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        historyCalls += 1;
        // Hold the build open so the concurrent requests overlap the in-flight job.
        await new Promise((resolve) => setTimeout(resolve, 60));
        return history as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    const N = 10;
    const responses = await Promise.all(
      Array.from({ length: N }, () =>
        app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-dedupe" }),
      ),
    );

    for (const res of responses) {
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.messageCount).toBeGreaterThan(0);
    }
    // The dominant win: K concurrent first-bootstraps ran ONE build, not K.
    expect(historyCalls).toBe(1);
    await app.close();
  });

  test("event loop stays responsive while a cold build runs (health-like microtask not starved)", async () => {
    const app = await createApp(config("responsive"));
    const context = contextOf(app);
    const history = syntheticHistory(400, 5);
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return history as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    // Measure setTimeout drift while the bootstrap runs — large drift = event-loop stall.
    let maxDrift = 0;
    let ticking = true;
    const tick = () => {
      const start = Date.now();
      setTimeout(() => {
        if (!ticking) return;
        maxDrift = Math.max(maxDrift, Date.now() - start - 5);
        tick();
      }, 5);
    };
    tick();

    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-responsive" });
    ticking = false;
    expect(res.statusCode).toBe(200);
    // Generous bound; the point is the projection no longer monopolises the thread for seconds.
    expect(maxDrift).toBeLessThan(500);
    await app.close();
  });

  test("projection resync markers serve local-first and reconcile through one background history fetch at a time", async () => {
    const app = await createApp(config("projection-resync-background"));
    const context = contextOf(app);
    allowLocalFirstSqliteForTests();
    vi.spyOn(context.gateway, "status").mockReturnValue({
      connected: true,
      gatewayUrl: "ws://127.0.0.1:18789",
      connectedAtMs: Date.now(),
      lastError: null,
      pendingRequests: 0,
      listenerCount: 0,
    });

    const sessions = ["marked-1", "marked-2", "marked-3", "marked-4"];
    for (const sessionKey of sessions) {
      context.messages.upsertSession({ sessionKey, sessionId: `${sessionKey}-sid`, data: { sessionKey, sessionId: `${sessionKey}-sid`, status: "done" }, updatedAtMs: Date.now() - 10 * 60_000 });
      const segment = context.messages.ensureActiveSegment({ sessionKey, sessionId: `${sessionKey}-sid` });
      context.messages.upsertMessages(normalizeHistoryMessages(sessionKey, [
        { role: "user", content: `cached ${sessionKey}`, __openclaw: { id: `${sessionKey}-cached`, seq: 1 } },
      ]), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });
      context.db.prepare("INSERT INTO v2_meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(chatProjectionResyncRequiredMetaKey(sessionKey), String(CHAT_PROJECTION_VERSION));
    }

    let activeHistory = 0;
    let maxActiveHistory = 0;
    let startedHistory = 0;
    let finishedHistory = 0;
    const pending: Array<{ sessionKey: string; resolve: (value: unknown) => void }> = [];
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, params?: Record<string, unknown>) => {
      if (method !== "chat.history") return {};
      const sessionKey = String(params?.sessionKey ?? "unknown");
      activeHistory += 1;
      startedHistory += 1;
      maxActiveHistory = Math.max(maxActiveHistory, activeHistory);
      try {
        return await new Promise<unknown>((resolve) => pending.push({ sessionKey, resolve })) as Record<string, unknown>;
      } finally {
        activeHistory -= 1;
        finishedHistory += 1;
      }
    });

    const responses = await Promise.all(sessions.map((sessionKey) =>
      app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${encodeURIComponent(sessionKey)}` }),
    ));

    for (const response of responses) {
      expect(response.statusCode).toBe(200);
      expect(response.json().messages).toHaveLength(1);
    }
    await waitFor(() => startedHistory === 1);
    expect(maxActiveHistory).toBe(1);

    for (let i = 0; i < sessions.length; i += 1) {
      await waitFor(() => pending.length > 0);
      const next = pending.shift()!;
      next.resolve({
        sessionKey: next.sessionKey,
        sessionId: `${next.sessionKey}-sid`,
        status: "done",
        messages: [{ role: "user", content: `canonical ${next.sessionKey}`, __openclaw: { id: `${next.sessionKey}-canonical`, seq: 1 } }],
      });
      await waitFor(() => finishedHistory >= i + 1);
      expect(maxActiveHistory).toBe(1);
    }

    await waitFor(() => sessions.every((sessionKey) => !context.db.prepare("SELECT value FROM v2_meta WHERE key = ?").get(chatProjectionResyncRequiredMetaKey(sessionKey))));
    expect(startedHistory).toBe(sessions.length);
    expect(maxActiveHistory).toBe(1);
    await app.close();
  });
});
