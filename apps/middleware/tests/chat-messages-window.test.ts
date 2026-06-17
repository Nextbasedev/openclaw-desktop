import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import type { ProjectedMessage } from "../src/features/chat/types.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-msg-window-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function visibleAssistant(sessionKey: string, openclawSeq: number): ProjectedMessage {
  return {
    sessionKey,
    openclawSeq,
    messageId: `vis-${openclawSeq}`,
    role: "assistant",
    data: { id: `vis-${openclawSeq}`, role: "assistant", text: `visible ${openclawSeq}` },
    updatedAtMs: openclawSeq * 1000,
  };
}

function hiddenSubagent(sessionKey: string, openclawSeq: number): ProjectedMessage {
  const id = `hidden-${openclawSeq}`;
  return {
    sessionKey,
    openclawSeq,
    messageId: id,
    role: "user",
    data: {
      id,
      role: "user",
      // Per-seq unique text so the stripped-replay dedupe path in upsertMessages
      // does not collapse them onto a single seq.
      text: `<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent\nseq:${openclawSeq}`,
      provenance: { sourceTool: "subagent_announce" },
      __openclaw: { id, runId: `hidden-run-${openclawSeq}` },
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

describe("/api/chat/messages window envelope", () => {
  test("response includes window metadata fields", async () => {
    const app = await createApp(config("envelope-fields"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    const seeds: ProjectedMessage[] = [];
    for (let i = 1; i <= 50; i++) seeds.push(visibleAssistant("s1", i));
    ctx.messages.upsertMessages(seeds);

    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages?sessionKey=s1&beforeSeq=999999&limit=10",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("hasOlder");
    expect(body).toHaveProperty("hasNewer");
    expect(body).toHaveProperty("oldestSeq");
    expect(body).toHaveProperty("newestSeq");
    expect(body).toHaveProperty("visibleCount");
    expect(body).toHaveProperty("scannedCount");
    expect(body).toHaveProperty("epoch");
    expect(body.visibleCount).toBe(10);
    expect(body.oldestSeq).toBe(41);
    expect(body.newestSeq).toBe(50);
    expect(body.hasOlder).toBe(true);
    expect(body.hasNewer).toBe(false);
    expect(typeof body.epoch).toBe("string");
    expect(body.epoch.length).toBeGreaterThan(0);
    await app.close();
  });

  test("response fills @limit visible rows even when the tail is hidden", async () => {
    const app = await createApp(config("hidden-tail"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    const seeds: ProjectedMessage[] = [];
    // 5 visible early.
    for (let i = 1; i <= 5; i++) seeds.push(visibleAssistant("s1", i));
    // 10 hidden in the tail.
    for (let i = 0; i < 10; i++) seeds.push(hiddenSubagent("s1", 100 + i));
    ctx.messages.upsertMessages(seeds);

    const res = await app.inject({
      method: "GET",
      url: "/api/chat/messages?sessionKey=s1&beforeSeq=999999&limit=10",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.visibleCount).toBe(5);
    expect(body.messages.length).toBe(5);
    expect(body.hasOlder).toBe(false);
    expect(body.oldestSeq).toBe(1);
    expect(body.newestSeq).toBe(5);
    await app.close();
  });
});
