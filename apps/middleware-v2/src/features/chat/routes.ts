import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../app.js";
import { HttpError } from "../../lib/errors.js";
import { createLogger, errorMeta } from "../../lib/logger.js";
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
  status?: string;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
};

function objectData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function attachmentMetadata(raw: unknown) {
  if (!Array.isArray(raw)) return { count: 0 };
  return {
    count: raw.length,
    items: raw.slice(0, 20).map((item) => {
      const attachment = objectData(item);
      return {
        name: typeof attachment.name === "string" ? attachment.name.slice(0, 200) : undefined,
        mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
        size: typeof attachment.size === "number" ? attachment.size : undefined,
        hasContent: typeof attachment.content === "string" && attachment.content.length > 0,
      };
    }),
  };
}

function isTerminalSendStatus(status: unknown) {
  return typeof status === "string" && ["done", "complete", "completed", "success", "succeeded", "finished"].includes(status.trim().toLowerCase());
}

function gatewaySendCompleted(result: Record<string, unknown>, history: ChatHistoryResponse | null) {
  if (isTerminalSendStatus(result.status) || isTerminalSendStatus(history?.status)) return true;
  return Boolean(history?.messages?.some((message) => objectData(message).role === "assistant"));
}

const sendBody = z.object({
  sessionKey: z.string().min(1),
  text: z.string().optional(),
  message: z.string().optional(),
  attachments: z.unknown().optional(),
  idempotencyKey: z.string().min(1),
  clientMessageId: z.string().min(1).optional(),
  timeoutMs: z.coerce.number().int().positive().optional(),
  agentId: z.string().optional(),
  label: z.string().optional(),
  execPolicy: z.unknown().optional(),
});

const approvalResolveBody = z.object({
  approvalId: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  decision: z.enum(["allow-once", "allow-always", "deny"]),
});

export async function registerChatRoutes(app: FastifyInstance, context: AppContext) {
  const log = createLogger("chat-route");

  app.post("/api/exec/approval/resolve", async (request) => {
    const parsed = approvalResolveBody.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid approval resolve body", "INVALID_BODY", parsed.error.flatten());
    }
    const approvalId = parsed.data.approvalId ?? parsed.data.id;
    if (!approvalId) throw new HttpError(400, "approvalId is required", "BAD_REQUEST");
    log.info("approval.resolve.start", { approvalId, decision: parsed.data.decision });
    const result = await context.gateway.request<Record<string, unknown>>("exec.approval.resolve", {
      id: approvalId,
      decision: parsed.data.decision,
    }, 30_000);
    log.info("approval.resolve.end", { approvalId, decision: parsed.data.decision });
    return { ok: true, approvalId, decision: parsed.data.decision, ...result };
  });

  app.post("/api/chat/send", async (request) => {
    const parsed = sendBody.safeParse(request.body);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat send body", "INVALID_BODY", parsed.error.flatten());
    }
    const input = parsed.data;
    const rawMessage = input.text ?? input.message ?? "";
    if (!rawMessage.trim()) throw new HttpError(400, "message is required", "BAD_REQUEST");
    log.info("send.start", {
      requestId: request.id,
      sessionKey: input.sessionKey,
      idempotencyKey: input.idempotencyKey,
      clientMessageId: input.clientMessageId,
      hasText: rawMessage.trim().length > 0,
      attachments: attachmentMetadata(input.attachments),
      hasExecPolicy: input.execPolicy !== undefined,
      agentId: input.agentId || "main",
    });

    log.info("session.create.start", { sessionKey: input.sessionKey, agentId: input.agentId || "main", hasLabel: Boolean(input.label) });
    await context.gateway.request("sessions.create", {
      key: input.sessionKey,
      agentId: input.agentId || "main",
      label: input.label || "New Chat",
    }).then(() => {
      log.info("session.create.end", { sessionKey: input.sessionKey });
    }).catch((error) => {
      log.warn("session.create.fail_ignored", { sessionKey: input.sessionKey, ...errorMeta(error) });
      return null;
    });

    if (input.execPolicy !== undefined) {
      const rawPolicy = input.execPolicy && typeof input.execPolicy === "object" ? input.execPolicy as { security?: unknown; ask?: unknown } : null;
      const execSecurity = rawPolicy?.security === "allowlist" || rawPolicy?.security === "full" ? rawPolicy.security : null;
      const execAsk = rawPolicy?.ask === "off" || rawPolicy?.ask === "on-miss" || rawPolicy?.ask === "always" ? rawPolicy.ask : null;
      log.info("session.patch.start", { sessionKey: input.sessionKey, execSecurity, execAsk, clearingPolicy: input.execPolicy === null });
      await context.gateway.request("sessions.patch", input.execPolicy === null
        ? { key: input.sessionKey, execSecurity: null, execAsk: null }
        : { key: input.sessionKey, execSecurity, execAsk });
      log.info("session.patch.end", { sessionKey: input.sessionKey, execSecurity, execAsk });
    }

    return context.sendQueue.run(input.sessionKey, async () => {
          log.info("send.queue.enter", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey });
          await context.chatLive.ensureSessionSubscribed(input.sessionKey);

          const prepared = prepareMessageAndAttachments(rawMessage, input.attachments);
          log.info("send.prepared", {
            sessionKey: input.sessionKey,
            idempotencyKey: input.idempotencyKey,
            hasMessage: prepared.message.trim().length > 0,
            gatewayAttachmentCount: prepared.attachments?.length ?? 0,
            sourceAttachments: attachmentMetadata(input.attachments),
          });
          const nowIso = new Date().toISOString();
          const clientMessage = {
            role: "user",
            text: prepared.message,
            createdAt: nowIso,
            isOptimistic: true,
            __clientOptimistic: true,
            __openclaw: {
              id: input.clientMessageId || `client:${input.idempotencyKey}`,
            },
          };
          context.chatLive.addOptimisticUser(input.sessionKey, {
            id: clientMessage.__openclaw.id,
            text: prepared.message,
          });
          const optimisticCreatedAtMs = Date.now();
          const optimisticSeq = context.messages.nextMessageSeq(input.sessionKey);
          context.messages.insertOptimisticMessage({
            sessionKey: input.sessionKey,
            openclawSeq: optimisticSeq,
            messageId: clientMessage.__openclaw.id,
            role: "user",
            data: clientMessage,
            updatedAtMs: optimisticCreatedAtMs,
          });
          log.info("message.persist.optimistic", { sessionKey: input.sessionKey, messageId: clientMessage.__openclaw.id, messageSeq: optimisticSeq, role: "user" });
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
          log.info("patch.broadcast", { sessionKey: input.sessionKey, type: event.eventType, cursor: event.cursor, optimistic: true });
          const existingSession = context.messages.getSession(input.sessionKey);
          context.messages.upsertSession({
            sessionKey: input.sessionKey,
            sessionId: existingSession?.sessionId ?? null,
            data: {
              ...objectData(existingSession?.data),
              sessionKey: input.sessionKey,
              sessionId: existingSession?.sessionId ?? null,
              status: "running",
              statusLabel: "Thinking",
            },
          });
          log.info("session.status.persist", { sessionKey: input.sessionKey, sessionId: existingSession?.sessionId ?? null, status: "running", statusLabel: "Thinking" });
          const statusEvent = context.messages.appendProjectionEvent({
            sessionKey: input.sessionKey,
            eventType: "chat.status",
            payload: {
              sessionKey: input.sessionKey,
              status: "thinking",
              statusLabel: "Thinking",
              optimistic: true,
              idempotencyKey: input.idempotencyKey,
            },
          });
          context.patchBus.broadcast({
            cursor: statusEvent.cursor,
            type: statusEvent.eventType,
            sessionKey: statusEvent.sessionKey,
            payload: statusEvent.payload,
            createdAtMs: statusEvent.createdAtMs,
          });
          log.info("status.broadcast", { sessionKey: input.sessionKey, type: statusEvent.eventType, cursor: statusEvent.cursor, status: "thinking", idempotencyKey: input.idempotencyKey });

          try {
            log.info("gateway.chat.send.start", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, gatewayAttachmentCount: prepared.attachments?.length ?? 0 });
            const result = await context.gateway.request<Record<string, unknown>>("chat.send", {
              sessionKey: input.sessionKey,
              message: prepared.message,
              timeoutMs: input.timeoutMs || 120_000,
              idempotencyKey: input.idempotencyKey,
              ...(prepared.attachments ? { attachments: prepared.attachments } : {}),
            }, input.timeoutMs || 130_000);
            log.info("gateway.chat.send.end", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, status: typeof result.status === "string" ? result.status : undefined, runId: typeof result.runId === "string" ? result.runId : undefined });

            log.info("gateway.history.load.start", { sessionKey: input.sessionKey, limit: 200 });
            const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
              sessionKey: input.sessionKey,
              limit: 200,
            }).then((loaded) => {
              log.info("gateway.history.load.end", { sessionKey: input.sessionKey, messageCount: loaded.messages?.length ?? 0, status: loaded.status ?? null, sessionId: loaded.sessionId ?? null });
              return loaded;
            }).catch((error) => {
              log.warn("gateway.history.load.fail_ignored", { sessionKey: input.sessionKey, ...errorMeta(error) });
              return null;
            });
            if (history?.messages?.length) {
              const normalized = normalizeHistoryMessages(input.sessionKey, history.messages);
              const projection = context.messages.upsertMessages(normalized);
              log.info("history.persist", { sessionKey: input.sessionKey, normalized: normalized.length, upserted: projection.upserted, lastSeq: projection.lastSeq });
              for (const projected of projection.changedMessages) {
                const historyEvent = context.messages.appendProjectionEvent({
                  sessionKey: input.sessionKey,
                  eventType: "chat.message.upsert",
                  payload: {
                    sessionKey: input.sessionKey,
                    message: projected.data,
                    messageSeq: projected.openclawSeq,
                  },
                });
                context.patchBus.broadcast({
                  cursor: historyEvent.cursor,
                  type: historyEvent.eventType,
                  sessionKey: historyEvent.sessionKey,
                  payload: historyEvent.payload,
                  createdAtMs: historyEvent.createdAtMs,
                });
                log.info("patch.broadcast", { sessionKey: input.sessionKey, type: historyEvent.eventType, cursor: historyEvent.cursor, messageSeq: projected.openclawSeq, role: projected.role });
              }
            }

            if (gatewaySendCompleted(result, history)) {
              const doneEvent = context.messages.appendProjectionEvent({
                sessionKey: input.sessionKey,
                eventType: "chat.status",
                payload: {
                  sessionKey: input.sessionKey,
                  status: "done",
                  statusLabel: null,
                  idempotencyKey: input.idempotencyKey,
                },
              });
              context.messages.upsertSession({
                sessionKey: input.sessionKey,
                sessionId: existingSession?.sessionId ?? null,
                data: {
                  ...objectData(context.messages.getSession(input.sessionKey)?.data),
                  sessionKey: input.sessionKey,
                  sessionId: existingSession?.sessionId ?? null,
                  status: "done",
                  statusLabel: null,
                },
              });
              log.info("session.status.persist", { sessionKey: input.sessionKey, sessionId: existingSession?.sessionId ?? null, status: "done", statusLabel: null });
              context.patchBus.broadcast({
                cursor: doneEvent.cursor,
                type: doneEvent.eventType,
                sessionKey: doneEvent.sessionKey,
                payload: doneEvent.payload,
                createdAtMs: doneEvent.createdAtMs,
              });
              log.info("status.broadcast", { sessionKey: input.sessionKey, type: doneEvent.eventType, cursor: doneEvent.cursor, status: "done", idempotencyKey: input.idempotencyKey });
            }

            log.info("send.end", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, completed: gatewaySendCompleted(result, history), status: typeof result.status === "string" ? result.status : undefined });
            return { ok: true, sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...result };
          } catch (error) {
            log.error("send.fail", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...errorMeta(error) });
            const errorEvent = context.messages.appendProjectionEvent({
              sessionKey: input.sessionKey,
              eventType: "chat.status",
              payload: {
                sessionKey: input.sessionKey,
                status: "error",
                statusLabel: error instanceof Error ? error.message : "Message failed",
                idempotencyKey: input.idempotencyKey,
              },
            });
            const statusLabel = error instanceof Error ? error.message : "Message failed";
            context.messages.upsertSession({
              sessionKey: input.sessionKey,
              sessionId: existingSession?.sessionId ?? null,
              data: {
                ...objectData(context.messages.getSession(input.sessionKey)?.data),
                sessionKey: input.sessionKey,
                sessionId: existingSession?.sessionId ?? null,
                status: "error",
                statusLabel,
              },
            });
            log.info("session.status.persist", { sessionKey: input.sessionKey, sessionId: existingSession?.sessionId ?? null, status: "error", errorMessage: errorMeta(error).errorMessage });
            context.patchBus.broadcast({
              cursor: errorEvent.cursor,
              type: errorEvent.eventType,
              sessionKey: errorEvent.sessionKey,
              payload: errorEvent.payload,
              createdAtMs: errorEvent.createdAtMs,
            });
            log.info("status.broadcast", { sessionKey: input.sessionKey, type: errorEvent.eventType, cursor: errorEvent.cursor, status: "error", idempotencyKey: input.idempotencyKey });
            throw error;
          }
    });
  });

  app.post("/api/chat/abort", async (request) => {
    const parsed = z.object({ sessionKey: z.string().min(1), runId: z.string().optional() }).safeParse(request.body);
    if (!parsed.success) throw new HttpError(400, "Invalid chat abort body", "INVALID_BODY", parsed.error.flatten());
    log.info("abort.start", { sessionKey: parsed.data.sessionKey, runId: parsed.data.runId });
    const result = await context.gateway.request<Record<string, unknown>>("chat.abort", parsed.data, 30_000);
    log.info("abort.end", { sessionKey: parsed.data.sessionKey, runId: parsed.data.runId, status: typeof result.status === "string" ? result.status : undefined });
    return { ok: true, ...result };
  });

  app.get("/api/chat/bootstrap", async (request) => {
    const parsed = bootstrapQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat bootstrap query", "INVALID_QUERY", parsed.error.flatten());
    }
    log.info("bootstrap.start", { sessionKey: parsed.data.sessionKey, limit: parsed.data.limit, hasMaxChars: parsed.data.maxChars !== undefined });
    const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
      sessionKey: parsed.data.sessionKey,
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.maxChars ? { maxChars: parsed.data.maxChars } : {}),
    });
    log.info("bootstrap.gateway.history", { sessionKey: history.sessionKey ?? parsed.data.sessionKey, sessionId: history.sessionId ?? null, messageCount: history.messages?.length ?? 0, status: history.status ?? null });

    const sessionKey = history.sessionKey ?? parsed.data.sessionKey;
    const messages = history.messages ?? [];
    const normalized = normalizeHistoryMessages(sessionKey, messages);
    const existingSession = context.messages.getSession(sessionKey);
    const sessionData = {
      ...objectData(existingSession?.data),
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      ...(history.status ? { status: history.status } : {}),
      thinkingLevel: history.thinkingLevel,
      fastMode: history.fastMode,
      verboseLevel: history.verboseLevel,
    };
    context.messages.upsertSession({
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      data: sessionData,
    });
    log.info("bootstrap.session.persist", { sessionKey, sessionId: history.sessionId ?? existingSession?.sessionId ?? null, status: typeof sessionData.status === "string" ? sessionData.status : null });
    const projection = context.messages.upsertMessages(normalized);
    log.info("bootstrap.messages.persist", { sessionKey, normalized: normalized.length, upserted: projection.upserted, lastSeq: projection.lastSeq });
    const projectedMessages = context.messages.listMessages(sessionKey, { limit: parsed.data.limit ?? 1000 }).map((message) => message.data);
    log.info("bootstrap.messages.read", { sessionKey, messageCount: projectedMessages.length, limit: parsed.data.limit ?? 1000 });
    await context.chatLive.ensureSessionSubscribed(sessionKey);
    const event = context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.bootstrap",
      payload: { sessionKey, messageCount: projectedMessages.length, lastSeq: projection.lastSeq },
    });
    log.info("bootstrap.end", { sessionKey, sessionId: history.sessionId ?? null, messageCount: projectedMessages.length, status: typeof sessionData.status === "string" ? sessionData.status : null, cursor: event.cursor });

    return {
      ok: true,
      source: "middleware-v2-projection",
      sessionKey,
      sessionId: history.sessionId ?? null,
      messages: projectedMessages,
      messageCount: projectedMessages.length,
      sessionStatus: typeof sessionData.status === "string" ? sessionData.status : null,
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
    log.info("messages.read.start", { sessionKey: parsed.data.sessionKey, afterSeq: parsed.data.afterSeq ?? 0, limit: parsed.data.limit });
    const messages = context.messages.listMessages(parsed.data.sessionKey, {
      afterSeq: parsed.data.afterSeq,
      limit: parsed.data.limit,
    });
    log.info("messages.read.end", { sessionKey: parsed.data.sessionKey, messageCount: messages.length });
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
