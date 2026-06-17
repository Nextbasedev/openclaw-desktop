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
    databasePath: path.join(os.tmpdir(), `openclaw-v2-seq-epoch-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function userMessage(sessionKey: string, openclawSeq: number): ProjectedMessage {
  return {
    sessionKey,
    openclawSeq,
    messageId: `u-${openclawSeq}`,
    role: "user",
    data: {
      id: `u-${openclawSeq}`,
      role: "user",
      text: `msg ${openclawSeq}`,
      __openclaw: { id: `u-${openclawSeq}`, runId: `r-${openclawSeq}` },
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

describe("audit Bug 5: per-session seqEpoch surfaces mutations to the frontend", () => {
  test("getSessionSeqEpoch returns a stable non-empty string per session", async () => {
    const app = await createApp(config("epoch-stable"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    ctx.messages.upsertMessages([userMessage("s1", 1)]);
    const e1 = ctx.messages.getSessionSeqEpoch("s1");
    const e2 = ctx.messages.getSessionSeqEpoch("s1");
    expect(typeof e1).toBe("string");
    expect(e1.length).toBeGreaterThan(0);
    expect(e1).toBe(e2);
    await app.close();
  });

  test("two distinct sessions get distinct epoch values", async () => {
    const app = await createApp(config("epoch-per-session"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    ctx.messages.ensureActiveSegment({ sessionKey: "s2" });
    ctx.messages.upsertMessages([userMessage("s1", 1)]);
    ctx.messages.upsertMessages([userMessage("s2", 1)]);
    const eA = ctx.messages.getSessionSeqEpoch("s1");
    const eB = ctx.messages.getSessionSeqEpoch("s2");
    expect(eA).not.toBe(eB);
    await app.close();
  });

  test("resequenceSessionMessages bumps the epoch", async () => {
    const app = await createApp(config("epoch-bump-on-resequence"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    ctx.messages.upsertMessages([userMessage("s1", 1), userMessage("s1", 2), userMessage("s1", 3)]);
    const before = ctx.messages.getSessionSeqEpoch("s1");
    ctx.messages.resequenceSessionMessages("s1");
    const after = ctx.messages.getSessionSeqEpoch("s1");
    expect(after).not.toBe(before);
    expect(typeof after).toBe("string");
    expect(after.length).toBeGreaterThan(0);
    await app.close();
  });

  test("/api/chat/messages response envelope.epoch matches getSessionSeqEpoch and changes after resequence", async () => {
    const app = await createApp(config("epoch-in-envelope"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    ctx.messages.upsertMessages([userMessage("s1", 1), userMessage("s1", 2), userMessage("s1", 3)]);

    const r1 = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s1&beforeSeq=999&limit=10" });
    expect(r1.statusCode).toBe(200);
    const body1 = r1.json();
    const epochBefore = ctx.messages.getSessionSeqEpoch("s1");
    expect(body1.epoch).toBe(epochBefore);
    expect(typeof body1.epoch).toBe("string");
    expect(body1.epoch.length).toBeGreaterThan(0);

    ctx.messages.resequenceSessionMessages("s1");
    const epochAfter = ctx.messages.getSessionSeqEpoch("s1");
    expect(epochAfter).not.toBe(epochBefore);

    const r2 = await app.inject({ method: "GET", url: "/api/chat/messages?sessionKey=s1&beforeSeq=999&limit=10" });
    const body2 = r2.json();
    expect(body2.epoch).toBe(epochAfter);
    expect(body2.epoch).not.toBe(body1.epoch);
    await app.close();
  });

  test("/api/chat/bootstrap response includes the current epoch", async () => {
    const app = await createApp(config("epoch-in-bootstrap"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });
    ctx.messages.upsertMessages([userMessage("s1", 1)]);
    // chat.history call goes to gateway; stub so bootstrap doesn't hang.
    (ctx.gateway as unknown as { request: (m: string) => Promise<unknown> }).request = async (method: string) => {
      if (method === "chat.history") return { sessionKey: "s1", messages: [] };
      return { ok: true };
    };
    const res = await app.inject({ method: "GET", url: "/api/chat/bootstrap?sessionKey=s1" });
    expect(res.statusCode).toBe(200);
    const epoch = ctx.messages.getSessionSeqEpoch("s1");
    expect(res.json().epoch).toBe(epoch);
    await app.close();
  });
});
