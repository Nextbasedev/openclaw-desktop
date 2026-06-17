import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";
import { isVisibleMessage } from "../src/features/chat/message-normalizer.js";
import type { ProjectedMessage } from "../src/features/chat/types.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-filter-consistency-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

function visibleUser(sessionKey: string, openclawSeq: number): ProjectedMessage {
  return {
    sessionKey,
    openclawSeq,
    messageId: `u-${openclawSeq}`,
    role: "user",
    data: {
      id: `u-${openclawSeq}`,
      role: "user",
      text: `user ${openclawSeq}`,
      __openclaw: { id: `u-${openclawSeq}`, runId: `r-${openclawSeq}` },
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

function visibleAssistant(sessionKey: string, openclawSeq: number): ProjectedMessage {
  return {
    sessionKey,
    openclawSeq,
    messageId: `a-${openclawSeq}`,
    role: "assistant",
    data: {
      id: `a-${openclawSeq}`,
      role: "assistant",
      text: `assistant ${openclawSeq}`,
      __openclaw: { id: `a-${openclawSeq}`, runId: `r-${openclawSeq}` },
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

function hiddenSubagent(sessionKey: string, openclawSeq: number): ProjectedMessage {
  const id = `sub-${openclawSeq}`;
  return {
    sessionKey,
    openclawSeq,
    messageId: id,
    role: "user",
    data: {
      id,
      role: "user",
      text: `<<<BEGIN_OPENCLAW_INTERNAL_CONTEXT>>>\nsource: subagent\nseq:${openclawSeq}`,
      provenance: { sourceTool: "subagent_announce" },
      __openclaw: { id, runId: `sub-run-${openclawSeq}` },
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

function hiddenAttachedFileEcho(sessionKey: string, openclawSeq: number): ProjectedMessage {
  const id = `att-${openclawSeq}`;
  return {
    sessionKey,
    openclawSeq,
    messageId: id,
    role: "assistant",
    data: {
      id,
      role: "assistant",
      text: `<attached-file name="foo-${openclawSeq}.txt">content ${openclawSeq}</attached-file>`,
      __openclaw: { id, runId: `att-run-${openclawSeq}` },
    },
    updatedAtMs: openclawSeq * 1000,
  };
}

function idsOf(messages: Array<{ messageId?: string | null; __openclaw?: { id?: string } } | Record<string, unknown>>): string[] {
  return messages.map((m) => {
    const oc = (m as any).__openclaw ?? null;
    if (oc && typeof oc.id === "string") return oc.id;
    if (typeof (m as any).messageId === "string") return (m as any).messageId;
    if (typeof (m as any).id === "string") return (m as any).id;
    return "?";
  });
}

describe("/api/chat/bootstrap and /api/chat/messages share the same hidden-row filter", () => {
  test("bootstrap and beforeSeq=MAX,limit=160 return identical visible message id sets", async () => {
    const app = await createApp(config("bootstrap-vs-messages-parity"));
    const ctx = contextOf(app);
    ctx.messages.ensureActiveSegment({ sessionKey: "s1" });

    // Seed 30 user+assistant turns plus 10 hidden subagent rows and 6
    // attached-file echo rows interleaved.
    const seeds: ProjectedMessage[] = [];
    let seq = 1;
    for (let i = 0; i < 30; i++) {
      seeds.push(visibleUser("s1", seq++));
      seeds.push(visibleAssistant("s1", seq++));
    }
    for (let i = 0; i < 10; i++) seeds.push(hiddenSubagent("s1", seq++));
    for (let i = 0; i < 6; i++) seeds.push(hiddenAttachedFileEcho("s1", seq++));
    ctx.messages.upsertMessages(seeds);

    // Pull via bootstrap path (listAllMessages + serializeProjectedMessage in
    // routes.ts) by inspecting projection events. We bypass the gateway by
    // reading the in-memory messages directly through the same predicate the
    // route uses now \u2014 the goal is to prove the predicate is consistent.
    const bootstrapMessages = (ctx.messages.listAllMessages("s1") as ProjectedMessage[])
      .filter((m) => isVisibleMessage(m.data))
      .map((m) => ({ id: m.messageId, openclawSeq: m.openclawSeq }));

    const res = await app.inject({
      method: "GET",
      url: `/api/chat/messages?sessionKey=s1&beforeSeq=${Number.MAX_SAFE_INTEGER}&limit=160`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const bootstrapIds = bootstrapMessages.map((m) => m.id).sort();
    const messagesIds = (body.messages as Array<{ messageId?: string | null }>)
      .map((m) => m.messageId ?? null)
      .filter((v): v is string => typeof v === "string")
      .sort();

    expect(messagesIds).toEqual(bootstrapIds);

    // None of the hidden rows should be in either set.
    expect(messagesIds.find((id) => id.startsWith("sub-"))).toBeUndefined();
    expect(messagesIds.find((id) => id.startsWith("att-"))).toBeUndefined();
    // All 60 visible rows should be present.
    expect(messagesIds.length).toBe(60);

    void idsOf;
    await app.close();
  });
});
