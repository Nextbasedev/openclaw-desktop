import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../app.js";
import { HttpError } from "../../lib/errors.js";
import { normalizeHistoryMessages } from "./message-normalizer.js";
import { prepareMessageAndAttachments } from "./attachments.js";

const bootstrapQuery = z.object({
  sessionKey: z.string().min(1),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  maxChars: z.coerce.number().int().positive().optional(),
});

type ChatHistoryResponse = {
  sessionKey?: string;
  sessionId?: string;
  messages?: unknown[];
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
};

const sendBody = z.object({
  sessionKey: z.string().min(1),
  text: z.string().optional(),
  message: z.string().optional(),
  attachments: z.unknown().optional(),
  idempotencyKey: z.string().min(1),
  timeoutMs: z.coerce.number().int().positive().optional(),
  agentId: z.string().optional(),
  label: z.string().optional(),
  execPolicy: z.unknown().optional(),
});

export async function registerChatRoutes(app: FastifyInstance, context: AppContext) {
  app.post("/api/chat/send", async (request) => {
    const parsed = sendBody.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat send body", "INVALID_BODY", parsed.error.flatten());
    }
    const input = parsed.data;
    const rawMessage = input.text ?? input.message ?? "";
    if (!rawMessage.trim()) throw new HttpError(400, "message is required", "BAD_REQUEST");

    await context.gateway.request("sessions.create", {
      key: input.sessionKey,
      agentId: input.agentId || "main",
      label: input.label || "New Chat",
    }).catch(() => null);

    if (input.execPolicy !== undefined) {
      const rawPolicy = input.execPolicy && typeof input.execPolicy === "object" ? input.execPolicy as { security?: unknown; ask?: unknown } : null;
      const execSecurity = rawPolicy?.security === "allowlist" || rawPolicy?.security === "full" ? rawPolicy.security : null;
      const execAsk = rawPolicy?.ask === "off" || rawPolicy?.ask === "on-miss" || rawPolicy?.ask === "always" ? rawPolicy.ask : null;
      await context.gateway.request("sessions.patch", input.execPolicy === null
        ? { key: input.sessionKey, execSecurity: null, execAsk: null }
        : { key: input.sessionKey, execSecurity, execAsk });
    }

    await context.chatLive.ensureSessionSubscribed(input.sessionKey);

    const prepared = prepareMessageAndAttachments(rawMessage, input.attachments);
    const nowIso = new Date().toISOString();
    const clientMessage = {
      role: "user",
      text: prepared.message,
      createdAt: nowIso,
      isOptimistic: true,
      __clientOptimistic: true,
      __openclaw: {
        id: `client:${input.idempotencyKey}`,
      },
    };
    context.chatLive.addOptimisticUser(input.sessionKey, {
      id: clientMessage.__openclaw.id,
      text: prepared.message,
    });
    const event = context.messages.appendProjectionEvent({
      sessionKey: input.sessionKey,
      eventType: "chat.message.upsert",
      payload: {
        sessionKey: input.sessionKey,
        message: clientMessage,
        optimistic: true,
        idempotencyKey: input.idempotencyKey,
      },
    });
    context.patchBus.broadcast({
      cursor: event.cursor,
      type: event.eventType,
      sessionKey: event.sessionKey,
      payload: event.payload,
      createdAtMs: event.createdAtMs,
    });

    const result = await context.gateway.request<Record<string, unknown>>("chat.send", {
      sessionKey: input.sessionKey,
      message: prepared.message,
      timeoutMs: input.timeoutMs || 120_000,
      idempotencyKey: input.idempotencyKey,
      ...(prepared.attachments ? { attachments: prepared.attachments } : {}),
    }, input.timeoutMs || 130_000);

    return { ok: true, sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...result };
  });

  app.post("/api/chat/abort", async (request) => {
    const parsed = z.object({ sessionKey: z.string().min(1), runId: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, "Invalid chat abort body", "INVALID_BODY", parsed.error.flatten());
    const result = await context.gateway.request<Record<string, unknown>>("chat.abort", parsed.data, 30_000);
    return { ok: true, ...result };
  });

  app.get("/api/chat/bootstrap", async (request) => {
    const parsed = bootstrapQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat bootstrap query", "INVALID_QUERY", parsed.error.flatten());
    }
    const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
      sessionKey: parsed.data.sessionKey,
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.maxChars ? { maxChars: parsed.data.maxChars } : {}),
    });

    const sessionKey = history.sessionKey ?? parsed.data.sessionKey;
    const messages = history.messages ?? [];
    const normalized = normalizeHistoryMessages(sessionKey, messages);
    context.messages.upsertSession({
      sessionKey,
      sessionId: history.sessionId ?? null,
      data: {
        sessionKey,
        sessionId: history.sessionId ?? null,
        thinkingLevel: history.thinkingLevel,
        fastMode: history.fastMode,
        verboseLevel: history.verboseLevel,
      },
    });
    const projection = context.messages.upsertMessages(normalized);
    await context.chatLive.ensureSessionSubscribed(sessionKey);
    const event = context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.bootstrap",
      payload: { sessionKey, messageCount: messages.length, lastSeq: projection.lastSeq },
    });

    return {
      ok: true,
      source: "openclaw-gateway",
      sessionKey,
      sessionId: history.sessionId ?? null,
      messages,
      messageCount: messages.length,
      thinkingLevel: history.thinkingLevel,
      fastMode: history.fastMode,
      verboseLevel: history.verboseLevel,
      projection: {
        enabled: true,
        upserted: projection.upserted,
        lastSeq: projection.lastSeq,
        cursor: event.cursor,
        liveSubscribed: true,
      },
    };
  });

  app.get("/api/chat/messages", async (request) => {
    const parsed = z.object({
      sessionKey: z.string().min(1),
      afterSeq: z.coerce.number().int().min(0).optional(),
      limit: z.coerce.number().int().positive().max(1000).optional(),
    }).safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat messages query", "INVALID_QUERY", parsed.error.flatten());
    }
    const messages = context.messages.listMessages(parsed.data.sessionKey, {
      afterSeq: parsed.data.afterSeq,
      limit: parsed.data.limit,
    });
    return {
      ok: true,
      source: "middleware-v2-projection",
      sessionKey: parsed.data.sessionKey,
      messages: messages.map((message) => ({
        sessionKey: message.sessionKey,
        openclawSeq: message.openclawSeq,
        messageId: message.messageId,
        role: message.role,
        data: message.data,
        updatedAtMs: message.updatedAtMs,
      })),
      messageCount: messages.length,
    };
  });
}
