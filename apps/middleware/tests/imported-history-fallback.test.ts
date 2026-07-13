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
    databasePath: path.join(os.tmpdir(), `openclaw-v2-imported-history-fallback-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

/**
 * Wire up imported-platform compat helpers so `context.compat.resolveImportedSourceSessionKey`
 * and `context.compat.importedPlatformSessionLink` behave as if a durable
 * telegram import were present for `desktopKey`, but WITHOUT touching the
 * compat/routes or provenance modules (which Phase B intentionally does not own).
 */
function stubImportedCompat(context: AppContext, params: {
  desktopKey: string;
  sourceKey: string;
  hydrated?: boolean;
  hydratedUpserted?: number;
}) {
  const base = context.compat ?? { touchChatActivity: () => {} };
  context.compat = {
    ...base,
    resolveImportedSourceSessionKey: (sessionKey) =>
      sessionKey === params.desktopKey ? params.sourceKey : null,
    importedPlatformSessionLink: (sessionKey) =>
      sessionKey === params.desktopKey
        ? { kind: "telegram", sourceSessionKey: params.sourceKey, label: "Telegram import" }
        : null,
    hydrateImportedChatHistory: async (sessionKey) => {
      if (sessionKey !== params.desktopKey) return { hydrated: false, reason: "not_imported_platform_session" };
      if (params.hydrated) return { hydrated: true, upserted: params.hydratedUpserted ?? 0, copiedMessages: params.hydratedUpserted ?? 0 };
      return { hydrated: false, reason: "empty_source_messages" };
    },
  };
}

function sourceMessages(count: number) {
  const messages: Record<string, unknown>[] = [];
  for (let index = 0; index < count; index += 1) {
    const seq = index + 1;
    messages.push({
      role: seq % 2 === 0 ? "assistant" : "user",
      content: [{ type: "text", text: `imported message ${seq}` }],
      __openclaw: { id: `imp-${seq}`, seq },
      timestamp: 1_781_000_000_000 + seq,
    });
  }
  return { sessionId: "telegram-source-sid", sessionFile: null, status: "done", messages };
}

afterEach(() => {
  vi.restoreAllMocks();
  clearLocalFirstBootstrapCache();
});

const DESKTOP_KEY = "agent:main:desktop:migrated-telegram-tests";
const SOURCE_KEY = "agent:main:telegram:group:-1:topic:7";

describe("imported history source-key Gateway fallback — bootstrap", () => {
  test("projects source-key Gateway history under the desktop key when desktop-key + local + transcript are all empty", async () => {
    const app = await createApp(config("bootstrap-projects-source"));
    const context = contextOf(app);
    stubImportedCompat(context, { desktopKey: DESKTOP_KEY, sourceKey: SOURCE_KEY });

    const desktopCalls: unknown[] = [];
    const sourceCalls: unknown[] = [];
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        if (payload?.sessionKey === DESKTOP_KEY) {
          desktopCalls.push(payload);
          // Desktop key has no gateway-side continue tail — fall through.
          return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
        }
        if (payload?.sessionKey === SOURCE_KEY) {
          sourceCalls.push(payload);
          return sourceMessages(12) as unknown as Record<string, unknown>;
        }
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${DESKTOP_KEY}&limit=160` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(desktopCalls.length).toBe(1);
    expect(sourceCalls.length).toBe(1);
    // Bootstrap projected source messages under the desktop key.
    expect(body.messageCount).toBe(12);
    expect(Array.isArray(body.messages)).toBe(true);
    // Confirm rows landed under the desktop key by reading the local projection.
    const projected = context.messages.listMessages(DESKTOP_KEY, { limit: 100 });
    expect(projected.length).toBe(12);
    for (const message of projected) {
      expect(message.sessionKey).toBe(DESKTOP_KEY);
    }
    expect(body.historyFallback).toBeTruthy();
    expect(body.historyFallback.reasons).toEqual(expect.arrayContaining(["desktop_empty", "source_gateway_projected"]));
    expect(body.historyFallback.reasons).not.toContain("source_gateway_empty");
    expect(body.historyFallback.reasons).not.toContain("source_gateway_failed");

    await app.close();
  });

  test("records source_gateway_empty and returns empty snapshot when source-key Gateway has no messages", async () => {
    const app = await createApp(config("bootstrap-source-empty"));
    const context = contextOf(app);
    stubImportedCompat(context, { desktopKey: DESKTOP_KEY, sourceKey: SOURCE_KEY });

    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        if (payload?.sessionKey === DESKTOP_KEY) return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
        if (payload?.sessionKey === SOURCE_KEY) return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${DESKTOP_KEY}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messageCount).toBe(0);
    expect(body.historyFallback?.reasons).toEqual(expect.arrayContaining(["desktop_empty", "source_gateway_empty"]));
    await app.close();
  });

  test("records source_gateway_failed and still returns a successful (empty) bootstrap when the source-key call throws", async () => {
    const app = await createApp(config("bootstrap-source-fail"));
    const context = contextOf(app);
    stubImportedCompat(context, { desktopKey: DESKTOP_KEY, sourceKey: SOURCE_KEY });

    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        if (payload?.sessionKey === DESKTOP_KEY) return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
        if (payload?.sessionKey === SOURCE_KEY) throw new Error("gateway offline");
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${DESKTOP_KEY}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.messageCount).toBe(0);
    expect(body.historyFallback?.reasons).toContain("source_gateway_failed");
    await app.close();
  });

  test("preserves local precedence — if transcript hydration already produced local rows, source-key Gateway is not consulted", async () => {
    const app = await createApp(config("bootstrap-local-precedence"));
    const context = contextOf(app);
    stubImportedCompat(context, { desktopKey: DESKTOP_KEY, sourceKey: SOURCE_KEY, hydrated: true, hydratedUpserted: 5 });

    // Simulate transcript hydration by pre-populating local projection for the
    // desktop key BEFORE bootstrap runs. hydrateImportedChatHistory reports
    // hydrated:true (as the compat stub does), so bootstrap should never call
    // the source-key gateway.
    const localHistory = sourceMessages(5).messages;
    context.messages.upsertSession({ sessionKey: DESKTOP_KEY, sessionId: "telegram-source-sid", data: { sessionKey: DESKTOP_KEY, status: "done" } });
    const segment = context.messages.ensureActiveSegment({ sessionKey: DESKTOP_KEY, sessionId: "telegram-source-sid", sessionFile: null });
    context.messages.upsertMessages(normalizeHistoryMessages(DESKTOP_KEY, localHistory), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    let sawSourceCall = false;
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        if (payload?.sessionKey === DESKTOP_KEY) return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
        if (payload?.sessionKey === SOURCE_KEY) { sawSourceCall = true; return sourceMessages(50) as unknown as Record<string, unknown>; }
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${DESKTOP_KEY}&limit=160` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messageCount).toBe(5);
    expect(sawSourceCall).toBe(false);
    expect(body.historyFallback?.reasons ?? []).not.toContain("source_gateway_projected");
    await app.close();
  });

  test("non-imported sessions get NO historyFallback diagnostic and no extra source-key gateway call", async () => {
    const app = await createApp(config("bootstrap-non-imported"));
    const context = contextOf(app);
    // Deliberately DO NOT stub compat — resolveImportedSourceSessionKey returns null for all keys.

    const requests: unknown[] = [];
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        requests.push(payload);
        return sourceMessages(3) as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=agent:main:desktop:regular-1&limit=160` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.historyFallback).toBeUndefined();
    expect(requests.length).toBe(1);
    await app.close();
  });
});

describe("imported history source-key Gateway fallback — older-page pagination", () => {
  test("older-page miss (beforeSeq) refills via source-key Gateway for imported sessions and returns the older window", async () => {
    const app = await createApp(config("older-page-source"));
    const context = contextOf(app);
    stubImportedCompat(context, { desktopKey: DESKTOP_KEY, sourceKey: SOURCE_KEY });

    // Seed local with only the tail (seq 20..30) — as if the imported desktop
    // key had a partial projection.
    const tailMessages = Array.from({ length: 11 }, (_, index) => {
      const seq = 20 + index;
      return {
        role: seq % 2 === 0 ? "assistant" : "user",
        content: [{ type: "text", text: `imported message ${seq}` }],
        __openclaw: { id: `imp-${seq}`, seq },
        timestamp: 1_781_000_000_000 + seq,
      };
    });
    context.messages.upsertSession({ sessionKey: DESKTOP_KEY, sessionId: "telegram-source-sid", data: { sessionKey: DESKTOP_KEY, status: "done" } });
    const segment = context.messages.ensureActiveSegment({ sessionKey: DESKTOP_KEY, sessionId: "telegram-source-sid", sessionFile: null });
    context.messages.upsertMessages(normalizeHistoryMessages(DESKTOP_KEY, tailMessages), { segmentId: segment.segmentId, sessionId: segment.sessionId, baseSeq: segment.baseSeq });

    const sourceCalls: unknown[] = [];
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history") {
        if (payload?.sessionKey === SOURCE_KEY) {
          sourceCalls.push(payload);
          // Return full source history including older seq (1..30)
          return sourceMessages(30) as unknown as Record<string, unknown>;
        }
        if (payload?.sessionKey === DESKTOP_KEY) {
          return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
        }
      }
      return {} as Record<string, unknown>;
    });

    // Ask for older window: everything strictly BEFORE seq 20 (limit 10).
    const res = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${DESKTOP_KEY}&beforeSeq=20&limit=10` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(sourceCalls.length).toBeGreaterThan(0);
    expect(body.messageCount).toBeGreaterThan(0);
    expect(body.messageCount).toBeLessThanOrEqual(10);
    for (const message of body.messages) {
      expect(message.sessionKey).toBe(DESKTOP_KEY);
      expect(message.openclawSeq).toBeLessThan(20);
    }
    expect(body.historyFallback?.reasons).toContain("source_gateway_projected");
    await app.close();
  });

  test("older-page miss for imported session records source_gateway_empty when the source has no messages, non-fatal", async () => {
    const app = await createApp(config("older-page-source-empty"));
    const context = contextOf(app);
    stubImportedCompat(context, { desktopKey: DESKTOP_KEY, sourceKey: SOURCE_KEY });

    // No local rows at all — pure miss.
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history" && payload?.sessionKey === SOURCE_KEY) {
        return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
      }
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${DESKTOP_KEY}&beforeSeq=200&limit=50` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.messageCount).toBe(0);
    expect(body.historyFallback?.reasons).toEqual(expect.arrayContaining(["desktop_empty", "source_gateway_empty"]));
    await app.close();
  });

  test("older-page miss for imported session survives a source-key Gateway error (source_gateway_failed, non-fatal)", async () => {
    const app = await createApp(config("older-page-source-fail"));
    const context = contextOf(app);
    stubImportedCompat(context, { desktopKey: DESKTOP_KEY, sourceKey: SOURCE_KEY });

    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string, payload?: Record<string, unknown>) => {
      if (method === "chat.history" && payload?.sessionKey === SOURCE_KEY) throw new Error("gateway unavailable");
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=${DESKTOP_KEY}&beforeSeq=999&limit=100` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.historyFallback?.reasons).toContain("source_gateway_failed");
    await app.close();
  });

  test("older-page miss for non-imported sessions is unchanged — no imported diagnostic on the response", async () => {
    const app = await createApp(config("older-page-non-imported"));
    const context = contextOf(app);

    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.history") return { sessionId: null, sessionFile: null, status: "done", messages: [] } as unknown as Record<string, unknown>;
      return {} as Record<string, unknown>;
    });

    const res = await app.inject({ method: "GET", url: `/api/chat/messages?sessionKey=agent:main:desktop:regular-2&beforeSeq=10&limit=5` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.historyFallback).toBeUndefined();
    await app.close();
  });
});
