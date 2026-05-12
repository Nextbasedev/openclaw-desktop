import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../../app.js";
import { HttpError } from "../../lib/errors.js";
import { createLogger, errorMeta } from "../../lib/logger.js";
import { messageTextMatchesSent, normalizeHistoryMessages, textFromMessage } from "./message-normalizer.js";
import { prepareMessageAndAttachments } from "./attachments.js";
import type { RunStatus } from "./repo.runs.js";
import { buildChatBootstrapSnapshot, canonicalPatchPayload } from "./projection.js";

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

function gatewaySendCompleted(result: Record<string, unknown>, currentHistory: { currentUserRepresented: boolean; assistantAfterCurrentUser: boolean } | null) {
  if (isTerminalSendStatus(result.status)) return true;
  return Boolean(currentHistory?.currentUserRepresented && currentHistory.assistantAfterCurrentUser);
}

function localRunId(idempotencyKey: string) {
  return `run:${idempotencyKey}`;
}

function runStatusFromGateway(status: unknown): RunStatus | null {
  if (typeof status !== "string") return null;
  const normalized = status.trim().toLowerCase();
  if (["done", "complete", "completed", "success", "succeeded", "finished"].includes(normalized)) return "done";
  if (["error", "failed", "failure"].includes(normalized)) return "error";
  if (["aborted", "abort", "cancelled", "canceled"].includes(normalized)) return "aborted";
  if (["streaming"].includes(normalized)) return "streaming";
  if (["queued", "pending"].includes(normalized)) return "queued";
  if (["started", "running", "thinking", "accepted"].includes(normalized)) return "thinking";
  return null;
}

function nowMs() {
  return Date.now();
}

function elapsedMs(startedAtMs: number) {
  return Math.max(0, Date.now() - startedAtMs);
}

function messageFactorSummary(messages: unknown[]) {
  let assistantCount = 0;
  let userCount = 0;
  let toolResultCount = 0;
  let toolCallCount = 0;
  let lastRole: string | null = null;
  for (const raw of messages) {
    const message = objectData(raw);
    const role = typeof message.role === "string" ? message.role : "unknown";
    lastRole = role;
    if (role === "assistant") assistantCount += 1;
    else if (role === "user") userCount += 1;
    else if (role === "tool" || role === "tool_result" || role === "toolResult") toolResultCount += 1;
    const content = message.content;
    if (Array.isArray(content)) {
      toolCallCount += content.filter((block) => {
        const item = objectData(block);
        return item.type === "toolCall" || item.type === "tool_use";
      }).length;
    }
  }
  return {
    total: messages.length,
    userCount,
    assistantCount,
    toolCallCount,
    toolResultCount,
    lastRole,
  };
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
  replyTo: z.unknown().optional(),
  autonomyMode: z.unknown().optional(),
}).passthrough();

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
    const sendStartedAtMs = nowMs();
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

    const sessionCreateStartedAtMs = nowMs();
    log.info("session.create.start", { sessionKey: input.sessionKey, agentId: input.agentId || "main", hasLabel: Boolean(input.label) });
    await context.gateway.request("sessions.create", {
      key: input.sessionKey,
      agentId: input.agentId || "main",
      label: input.label || "New Chat",
    }).then(() => {
      log.info("session.create.end", { sessionKey: input.sessionKey, durationMs: elapsedMs(sessionCreateStartedAtMs) });
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
          log.info("send.queue.enter", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });
          const subscribeStartedAtMs = nowMs();
          await context.chatLive.ensureSessionSubscribed(input.sessionKey);
          log.info("send.factor.subscribe.ready", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, durationMs: elapsedMs(subscribeStartedAtMs), elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });

          const prepared = prepareMessageAndAttachments(rawMessage, input.attachments);
          log.info("send.prepared", {
            sessionKey: input.sessionKey,
            idempotencyKey: input.idempotencyKey,
            hasMessage: prepared.message.trim().length > 0,
            gatewayAttachmentCount: prepared.attachments?.length ?? 0,
            sourceAttachments: attachmentMetadata(input.attachments),
          });
          const nowIso = new Date().toISOString();
          const runId = localRunId(input.idempotencyKey);
          const clientMessageId = input.clientMessageId || `client:${input.idempotencyKey}`;
          context.runs.upsertRun({
            runId,
            sessionKey: input.sessionKey,
            clientMessageId,
            idempotencyKey: input.idempotencyKey,
            status: "thinking",
            statusLabel: "Thinking",
            startedAtMs: sendStartedAtMs,
            updatedAtMs: Date.now(),
          });
          const optimisticRun = context.runs.getRun(runId);
          const clientMessage = {
            role: "user",
            text: prepared.message,
            createdAt: nowIso,
            isOptimistic: true,
            __clientOptimistic: true,
            __openclaw: {
              id: clientMessageId,
              clientMessageId,
              idempotencyKey: input.idempotencyKey,
              runId,
            },
          };
          context.chatLive.addOptimisticUser(input.sessionKey, {
            id: clientMessage.__openclaw.id,
            text: prepared.message,
            runId,
            idempotencyKey: input.idempotencyKey,
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
            payload: canonicalPatchPayload({
              sessionKey: input.sessionKey,
              semanticType: "chat.user.created",
              run: optimisticRun,
              messageId: clientMessage.__openclaw.id,
              payload: {
                sessionKey: input.sessionKey,
                message: clientMessage,
                optimistic: true,
                idempotencyKey: input.idempotencyKey,
                runId,
              },
            }),
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
            payload: canonicalPatchPayload({
              sessionKey: input.sessionKey,
              semanticType: "chat.run.status",
              run: optimisticRun,
              legacyStatus: "thinking",
              legacyStatusLabel: "Thinking",
              payload: {
                sessionKey: input.sessionKey,
                status: "thinking",
                statusLabel: "Thinking",
                optimistic: true,
                idempotencyKey: input.idempotencyKey,
                runId,
              },
            }),
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
            const gatewaySendStartedAtMs = nowMs();
            log.info("gateway.chat.send.start", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, gatewayAttachmentCount: prepared.attachments?.length ?? 0, elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });
            const result = await context.gateway.request<Record<string, unknown>>("chat.send", {
              sessionKey: input.sessionKey,
              message: prepared.message,
              timeoutMs: input.timeoutMs || 120_000,
              idempotencyKey: input.idempotencyKey,
              ...(prepared.attachments ? { attachments: prepared.attachments } : {}),
            }, input.timeoutMs || 130_000);
            log.info("gateway.chat.send.end", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, durationMs: elapsedMs(gatewaySendStartedAtMs), elapsedSinceRequestMs: elapsedMs(sendStartedAtMs), status: typeof result.status === "string" ? result.status : undefined, runId: typeof result.runId === "string" ? result.runId : undefined });
            const gatewayRunId = typeof result.runId === "string" && result.runId.trim() ? result.runId.trim() : null;
            const gatewayRunStatus = runStatusFromGateway(result.status) ?? "thinking";
            context.runs.upsertRun({
              runId,
              sessionKey: input.sessionKey,
              clientMessageId,
              idempotencyKey: input.idempotencyKey,
              gatewayRunId,
              status: gatewayRunStatus,
              statusLabel: gatewayRunStatus === "thinking" ? "Thinking" : null,
              startedAtMs: sendStartedAtMs,
              finishedAtMs: ["done", "error", "aborted"].includes(gatewayRunStatus) ? Date.now() : null,
              updatedAtMs: Date.now(),
            });

            const historyLoadStartedAtMs = nowMs();
            log.info("gateway.history.load.start", { sessionKey: input.sessionKey, limit: 200, elapsedSinceRequestMs: elapsedMs(sendStartedAtMs) });
            const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
              sessionKey: input.sessionKey,
              limit: 200,
            }).then((loaded) => {
              log.info("gateway.history.load.end", { sessionKey: input.sessionKey, durationMs: elapsedMs(historyLoadStartedAtMs), elapsedSinceRequestMs: elapsedMs(sendStartedAtMs), messageFactors: messageFactorSummary(loaded.messages ?? []), status: loaded.status ?? null, sessionId: loaded.sessionId ?? null });
              return loaded;
            }).catch((error) => {
              log.warn("gateway.history.load.fail_ignored", { sessionKey: input.sessionKey, ...errorMeta(error) });
              return null;
            });
            let currentHistory: { currentUserRepresented: boolean; assistantAfterCurrentUser: boolean } | null = null;
            if (history?.messages?.length) {
              const normalized = normalizeHistoryMessages(input.sessionKey, history.messages);
              const historyMaxSeq = normalized.reduce((max, message) => Math.max(max, message.openclawSeq), 0);
              const gatewayUserEcho = [...normalized].reverse().find((message) => message.role === "user" && message.openclawSeq >= optimisticSeq && messageTextMatchesSent(textFromMessage(message.data), prepared.message));
              const confirmedUser = gatewayUserEcho
                ? context.messages.confirmOptimisticUser(input.sessionKey, clientMessageId, gatewayUserEcho)
                : null;
              const currentUserSeq = confirmedUser?.openclawSeq ?? gatewayUserEcho?.openclawSeq ?? null;
              currentHistory = {
                currentUserRepresented: Boolean(gatewayUserEcho),
                assistantAfterCurrentUser: currentUserSeq !== null && normalized.some((message) => message.role === "assistant" && message.openclawSeq > currentUserSeq),
              };
              if (confirmedUser) {
                log.info("optimistic.user.confirmed", {
                  sessionKey: input.sessionKey,
                  optimisticId: clientMessageId,
                  gatewayMessageId: gatewayUserEcho?.messageId ?? null,
                  runId,
                });
              }
              const isStalePreSendHistory = !currentHistory.currentUserRepresented && historyMaxSeq < optimisticSeq;
              const normalizedToUpsert = isStalePreSendHistory
                ? []
                : confirmedUser && gatewayUserEcho
                  ? normalized.filter((message) => message !== gatewayUserEcho)
                  : normalized;
              const projection = normalizedToUpsert.length > 0
                ? context.messages.upsertMessages(normalizedToUpsert)
                : { upserted: 0, lastSeq: context.messages.nextMessageSeq(input.sessionKey) - 1, changedMessages: [] };
              log.info("history.persist", { sessionKey: input.sessionKey, normalized: normalized.length, upserted: projection.upserted, lastSeq: projection.lastSeq, historyMaxSeq, optimisticSeq, confirmedOptimistic: Boolean(confirmedUser), currentUserRepresented: currentHistory.currentUserRepresented, assistantAfterCurrentUser: currentHistory.assistantAfterCurrentUser, skippedStalePreSendHistory: isStalePreSendHistory });
              if (confirmedUser) {
                const confirmedEvent = context.messages.appendProjectionEvent({
                  sessionKey: input.sessionKey,
                  eventType: "chat.message.confirmed",
                  payload: canonicalPatchPayload({
                    sessionKey: input.sessionKey,
                    semanticType: "chat.user.confirmed",
                    run: context.runs.getRun(runId),
                    messageId: confirmedUser.messageId,
                    payload: {
                      sessionKey: input.sessionKey,
                      message: confirmedUser.data,
                      messageSeq: confirmedUser.openclawSeq,
                      optimisticId: clientMessageId,
                      gatewayMessageId: gatewayUserEcho?.messageId ?? null,
                      runId,
                    },
                  }),
                });
                context.patchBus.broadcast({
                  cursor: confirmedEvent.cursor,
                  type: confirmedEvent.eventType,
                  sessionKey: confirmedEvent.sessionKey,
                  payload: confirmedEvent.payload,
                  createdAtMs: confirmedEvent.createdAtMs,
                });
                log.info("patch.broadcast", { sessionKey: input.sessionKey, type: confirmedEvent.eventType, cursor: confirmedEvent.cursor, messageSeq: confirmedUser.openclawSeq, role: confirmedUser.role, runId });
              }
              for (const projected of projection.changedMessages) {
                if (!currentHistory.currentUserRepresented || currentUserSeq === null || projected.openclawSeq <= currentUserSeq) {
                  log.info("history.patch.skip_stale_for_current_run", { sessionKey: input.sessionKey, messageSeq: projected.openclawSeq, role: projected.role, runId, optimisticSeq, currentUserRepresented: currentHistory.currentUserRepresented });
                  continue;
                }
                const semanticType = projected.role === "assistant" ? "chat.assistant.final" : projected.role === "user" ? "chat.user.confirmed" : "chat.message.upsert";
                const historyEvent = context.messages.appendProjectionEvent({
                  sessionKey: input.sessionKey,
                  eventType: "chat.message.upsert",
                  payload: canonicalPatchPayload({
                    sessionKey: input.sessionKey,
                    semanticType,
                    run: context.runs.getRun(runId),
                    messageId: projected.messageId,
                    payload: {
                      sessionKey: input.sessionKey,
                      message: projected.data,
                      messageSeq: projected.openclawSeq,
                      runId,
                    },
                  }),
                });
                context.patchBus.broadcast({
                  cursor: historyEvent.cursor,
                  type: historyEvent.eventType,
                  sessionKey: historyEvent.sessionKey,
                  payload: historyEvent.payload,
                  createdAtMs: historyEvent.createdAtMs,
                });
                log.info("patch.broadcast", { sessionKey: input.sessionKey, type: historyEvent.eventType, cursor: historyEvent.cursor, messageSeq: projected.openclawSeq, role: projected.role, runId });
              }
            }

            if (gatewaySendCompleted(result, currentHistory)) {
              context.runs.updateRunStatus(runId, "done", { statusLabel: null });
              const doneRun = context.runs.getRun(runId);
              const doneEvent = context.messages.appendProjectionEvent({
                sessionKey: input.sessionKey,
                eventType: "chat.status",
                payload: canonicalPatchPayload({
                  sessionKey: input.sessionKey,
                  semanticType: "chat.run.done",
                  run: doneRun,
                  legacyStatus: "done",
                  payload: {
                    sessionKey: input.sessionKey,
                    status: "done",
                    statusLabel: null,
                    idempotencyKey: input.idempotencyKey,
                    runId,
                  },
                }),
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

            log.info("send.end", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, totalDurationMs: elapsedMs(sendStartedAtMs), completed: gatewaySendCompleted(result, currentHistory), status: typeof result.status === "string" ? result.status : undefined });
            return { ok: true, sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...result };
          } catch (error) {
            context.runs.updateRunStatus(runId, "error", { statusLabel: error instanceof Error ? error.message : "Message failed", error: errorMeta(error) });
            log.error("send.fail", { sessionKey: input.sessionKey, idempotencyKey: input.idempotencyKey, ...errorMeta(error) });
            const errorEvent = context.messages.appendProjectionEvent({
              sessionKey: input.sessionKey,
              eventType: "chat.status",
              payload: canonicalPatchPayload({
                sessionKey: input.sessionKey,
                semanticType: "chat.run.error",
                run: context.runs.getRun(runId),
                legacyStatus: "error",
                legacyStatusLabel: error instanceof Error ? error.message : "Message failed",
                payload: {
                  sessionKey: input.sessionKey,
                  status: "error",
                  statusLabel: error instanceof Error ? error.message : "Message failed",
                  idempotencyKey: input.idempotencyKey,
                  runId,
                },
              }),
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
    const projectedRun = parsed.data.runId
      ? context.runs.getRun(parsed.data.runId) ?? context.runs.findRunByGatewayRunId(parsed.data.runId)
      : context.runs.findLatestPendingRun(parsed.data.sessionKey);
    if (projectedRun) {
      context.runs.updateRunStatus(projectedRun.runId, "aborted", { statusLabel: null });
      context.messages.upsertSession({
        sessionKey: parsed.data.sessionKey,
        sessionId: context.messages.getSession(parsed.data.sessionKey)?.sessionId ?? null,
        data: { ...objectData(context.messages.getSession(parsed.data.sessionKey)?.data), sessionKey: parsed.data.sessionKey, status: "aborted", statusLabel: null },
      });
    }
    log.info("abort.end", { sessionKey: parsed.data.sessionKey, runId: parsed.data.runId, projectedRunId: projectedRun?.runId, status: typeof result.status === "string" ? result.status : undefined });
    return { ok: true, ...result };
  });

  app.get("/api/chat/bootstrap", async (request) => {
    const parsed = bootstrapQuery.safeParse(request.query);
    if (!parsed.success) {
      throw new HttpError(400, "Invalid chat bootstrap query", "INVALID_QUERY", parsed.error.flatten());
    }
    const bootstrapStartedAtMs = nowMs();
    log.info("bootstrap.start", { sessionKey: parsed.data.sessionKey, limit: parsed.data.limit, hasMaxChars: parsed.data.maxChars !== undefined });
    const gatewayHistoryStartedAtMs = nowMs();
    const history = await context.gateway.request<ChatHistoryResponse>("chat.history", {
      sessionKey: parsed.data.sessionKey,
      ...(parsed.data.limit ? { limit: parsed.data.limit } : {}),
      ...(parsed.data.maxChars ? { maxChars: parsed.data.maxChars } : {}),
    });
    log.info("bootstrap.gateway.history", { sessionKey: history.sessionKey ?? parsed.data.sessionKey, sessionId: history.sessionId ?? null, durationMs: elapsedMs(gatewayHistoryStartedAtMs), messageFactors: messageFactorSummary(history.messages ?? []), status: history.status ?? null });

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
    log.info("bootstrap.end", { sessionKey, sessionId: history.sessionId ?? null, totalDurationMs: elapsedMs(bootstrapStartedAtMs), messageCount: projectedMessages.length, status: typeof sessionData.status === "string" ? sessionData.status : null, cursor: event.cursor, factors: { gatewayHistoryMs: elapsedMs(gatewayHistoryStartedAtMs), normalized: normalized.length, upserted: projection.upserted, liveSubscribed: true } });

    return buildChatBootstrapSnapshot(context, {
      sessionKey,
      sessionId: history.sessionId ?? existingSession?.sessionId ?? null,
      sessionData,
      messages: projectedMessages,
      messageCount: projectedMessages.length,
      cursor: event.cursor,
      projection: { upserted: projection.upserted, lastSeq: projection.lastSeq, liveSubscribed: true },
      historyMeta: { thinkingLevel: history.thinkingLevel, fastMode: history.fastMode, verboseLevel: history.verboseLevel },
    });
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
