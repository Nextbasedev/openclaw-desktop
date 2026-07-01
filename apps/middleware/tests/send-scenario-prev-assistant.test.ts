import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { createApp } from "../src/app.js";
import type { AppContext } from "../src/app.js";
import type { MiddlewareConfig } from "../src/config/env.js";

function config(name: string): MiddlewareConfig {
  return {
    host: "127.0.0.1",
    port: 8787,
    databasePath: path.join(os.tmpdir(), `openclaw-v2-scenario-${name}-${Date.now()}-${Math.random()}.sqlite`),
    openclawGatewayUrl: "ws://127.0.0.1:18789",
    nodeEnv: "test",
  };
}

function contextOf(app: Awaited<ReturnType<typeof createApp>>): AppContext {
  return (app as typeof app & { v2Context: AppContext }).v2Context;
}

type Frame = { cursor?: number; type: string; sessionKey?: string; payload?: Record<string, unknown> };

function summarize(frames: Frame[]) {
  return frames.map((f) => {
    const p = f.payload ?? {};
    const message = p.message as { role?: string; text?: string; __openclaw?: { seq?: number } } | undefined;
    return {
      cursor: f.cursor,
      type: f.type,
      semanticType: p.semanticType,
      messageId: p.messageId,
      role: message?.role,
      text: message?.text,
      messageSeq: p.messageSeq ?? message?.__openclaw?.seq,
    };
  });
}

// End-to-end against the REAL middleware: seed a prior turn whose assistant
// answer used a tool, send a new message, stream the new answer, and confirm
// via gateway history. Capture the real patch-bus frames + bootstrap and assert
// the previous assistant answer never disappears and ordering stays correct.
describe("scenario: new send must not drop the previous assistant answer", () => {
  test("captures real frames and preserves prior turn", async () => {
    const app = await createApp(config("prev-assistant"));
    const context = contextOf(app);

    const SESSION = "s1";
    // Seed prior history: greeting, user "do tool", assistant "healthy" (tool).
    const now = Date.now();
    context.messages.upsertMessages([
      { sessionKey: SESSION, openclawSeq: 1, messageId: "a-greeting", role: "assistant",
        data: { id: "a-greeting", role: "assistant", text: "Hey Krish — I'm here.", __openclaw: { id: "a-greeting", seq: 1 } }, updatedAtMs: now - 5000 },
      { sessionKey: SESSION, openclawSeq: 2, messageId: "u-tool", role: "user",
        data: { id: "u-tool", role: "user", text: "do some tool call and give me one paragraph content", __openclaw: { id: "u-tool", seq: 2 } }, updatedAtMs: now - 4000 },
      { sessionKey: SESSION, openclawSeq: 3, messageId: "a-healthy", role: "assistant",
        data: { id: "a-healthy", role: "assistant", text: "Current session is healthy and running as Empire.", __openclaw: { id: "a-healthy", seq: 3, runId: "run-prev" } }, updatedAtMs: now - 3000 },
    ]);

    const frames: Frame[] = [];
    vi.spyOn(context.patchBus, "broadcast").mockImplementation((patch) => {
      frames.push(patch as Frame);
    });
    vi.spyOn(context.gateway, "request").mockImplementation(async (method: string) => {
      if (method === "chat.send") return { runId: "gw-run-new", status: "done" };
      if (method === "chat.history") {
        return {
          sessionKey: SESSION,
          messages: [
            { role: "assistant", text: "Hey Krish — I'm here.", __openclaw: { id: "a-greeting", seq: 1 } },
            { role: "user", text: "do some tool call and give me one paragraph content", __openclaw: { id: "u-tool", seq: 2 } },
            { role: "assistant", text: "Current session is healthy and running as Empire.", __openclaw: { id: "a-healthy", seq: 3, runId: "run-prev" } },
            { role: "user", text: "hyy", __openclaw: { id: "gw-user-hyy", seq: 4, runId: "gw-run-new", idempotencyKey: "idem-hyy" } },
            { role: "assistant", text: "Hey Krish.", __openclaw: { id: "gw-a-new", seq: 5, runId: "gw-run-new" } },
          ],
        };
      }
      return { ok: true };
    });

    // Send the new message "hyy".
    const send = await app.inject({
      method: "POST",
      url: "/api/chat/send",
      payload: { sessionKey: SESSION, text: "hyy", idempotencyKey: "idem-hyy", clientMessageId: "opt-hyy" },
    });
    expect(send.statusCode).toBe(200);

    const captured = summarize(frames);
    // eslint-disable-next-line no-console
    console.log("REAL PATCH FRAMES:\n" + JSON.stringify(captured, null, 2));

    // Persist the real frames as a fixture the frontend replay test consumes.
    // Normalize volatile wall-clock fields so re-runs produce identical bytes
    // (no git churn) while preserving the real frame shape/order/seqs.
    const normalizeTimes = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(normalizeTimes);
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>).map(([k, v]) => [
            k,
            /AtMs$|^createdAt$|^updatedAt$/.test(k) && (typeof v === "number" || typeof v === "string") ? 0 : normalizeTimes(v),
          ]),
        );
      }
      return value;
    };
    const fixtureDir = path.resolve(__dirname, "../../../packages/ui/lib/chat-engine-v2/__tests__/fixtures");
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, "realSendFrames.json"), JSON.stringify(normalizeTimes(frames), null, 2) + "\n");

    // Backend contract assertions (real WS/API):
    // 1. optimistic user created first
    expect(captured[0]).toMatchObject({ type: "chat.message.upsert", semanticType: "chat.user.created", role: "user", text: "hyy" });
    // 2. the confirmed user carries a real seq greater than the prior turn's
    const confirmed = captured.find((c) => c.type === "chat.message.confirmed" && c.role === "user");
    expect(confirmed).toBeTruthy();
    expect(typeof confirmed?.messageSeq).toBe("number");
    expect(confirmed?.messageSeq as number).toBeGreaterThan(3);
    // 3. the new assistant answer is sequenced AFTER the confirmed user
    const assistantFinal = captured.find((c) => c.role === "assistant" && c.text === "Hey Krish.");
    expect(assistantFinal).toBeTruthy();
    expect(assistantFinal?.messageSeq as number).toBeGreaterThan(confirmed?.messageSeq as number);

    // Bootstrap (what a reload sees) must preserve the whole timeline in order.
    const bootstrap = await app.inject({ method: "GET", url: `/api/chat/bootstrap?sessionKey=${SESSION}` });
    expect(bootstrap.statusCode).toBe(200);
    const messages = bootstrap.json().messages as Array<{ role: string; text?: string }>;
    const texts = messages.map((m) => m.text);
    expect(texts).toContain("Current session is healthy and running as Empire.");
    expect(texts).toEqual([
      "Hey Krish — I'm here.",
      "do some tool call and give me one paragraph content",
      "Current session is healthy and running as Empire.",
      "hyy",
      "Hey Krish.",
    ]);

    await app.close();
  });
});
