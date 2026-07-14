import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { clearLocalFirstBootstrapCache } from "../src/features/chat/routes.js";
import { normalizeHistoryMessages } from "../src/features/chat/message-normalizer.js";
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

function windowedHistory(total: number, startSeq: number, limit?: number) {
  const allMessages = Array.from({ length: total }, (_, index) => {
    const seq = index + 1;
    return {
      role: seq % 2 === 0 ? "assistant" : "user",
      content: [{ type: "text", text: `message ${seq}` }],
      __openclaw: { id: `m${seq}`, seq },
      timestamp: 1_781_000_000_000 + seq,
    };
  });
  const messages = typeof limit === "number"
    ? allMessages.slice(-limit)
    : allMessages.filter((message) => (message.__openclaw?.seq ?? 0) >= startSeq);
  return {
    sessionId: "sid-windowed",
    sessionFile: null,
    status: "done",
    messages,
  };
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

  test("bootstrap reports older history when returned window starts after seq 1 even if local count equals returned count", async () => {
    const app = await createApp(config("windowed-bootstrap"));
    const context = contextOf(app);

    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        return windowedHistory(298, 120, typeof payload?.limit === "number" ? payload.limit : undefined) as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-windowed&limit=160" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messageCount).toBe(100);
    expect(body.oldestLoadedSeq).toBe(199);
    expect(body.historyCoverage).toBe("windowed");
    expect(body.fullMessagesIncluded).toBe(false);
    expect(body.hasOlder).toBe(true);
    await app.close();
  });

  test("local-first bootstrap backfills to the requested limit when a recent local window is short but older history exists", async () => {
    const app = await createApp(config("local-first-windowed-bootstrap"));
    const context = contextOf(app);
    const sessionKey = "s-windowed-local";
    const localWindow = windowedHistory(298, 145).messages;

    context.messages.upsertSession({ sessionKey, sessionId: "sid-windowed", data: { sessionKey, status: "done" } });
    const segment = context.messages.ensureActiveSegment({ sessionKey, sessionId: "sid-windowed", sessionFile: null });
    context.messages.upsertMessages(normalizeHistoryMessages(sessionKey, localWindow), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    vi.spyOn(context.gateway, "status").mockReturnValue({
      connected: true,
      gatewayUrl: "ws://127.0.0.1:18789",
      connectedAtMs: Date.now(),
      lastError: null,
      pendingRequests: 0,
      listenerCount: 0,
    });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        return windowedHistory(298, 1, typeof payload?.limit === "number" ? payload.limit : undefined) as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${sessionKey}&limit=160` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messageCount).toBe(100);
    expect(body.oldestLoadedSeq).toBe(199);
    expect(body.historyCoverage).toBe("windowed");
    expect(body.hasOlder).toBe(true);
    await app.close();
  });

  test("older-page request backfills Gateway history when local SQLite only has the recent window", async () => {
    const app = await createApp(config("older-backfill"));
    const context = contextOf(app);
    const allMessages = Array.from({ length: 298 }, (_, index) => ({
      role: (index + 1) % 2 === 0 ? "assistant" : "user",
      content: [{ type: "text", text: `message ${index + 1}` }],
      __openclaw: { id: `m${index + 1}`, seq: index + 1 },
      timestamp: 1_781_000_000_000 + index + 1,
    }));

    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        const limit = typeof payload?.limit === "number" ? payload.limit : 160;
        return {
          sessionId: "sid-windowed",
          sessionFile: null,
          status: "done",
          messages: allMessages.slice(-limit),
        } as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    const bootstrap = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s-windowed&limit=179" });
    expect(bootstrap.statusCode).toBe(200);
    expect(bootstrap.json().oldestLoadedSeq).toBe(199);

    const older = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s-windowed&beforeSeq=199&limit=80" });
    expect(older.statusCode).toBe(200);
    const body = older.json();
    expect(body.messages.length).toBeGreaterThan(0);
    expect(body.messages.at(-1).openclawSeq).toBeLessThan(199);
    await app.close();
  });
});
