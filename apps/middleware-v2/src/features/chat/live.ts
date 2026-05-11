import type { AppContext } from "../../app.js";
import { createLogger, errorMeta } from "../../lib/logger.js";
import type { GatewayEvent } from "../gateway/client.js";
import { messageTextMatchesSent, normalizeHistoryMessages, normalizeMessageText, textFromMessage } from "./message-normalizer.js";
import type { OpenClawMessage } from "./types.js";
import { canonicalPatchPayload } from "./projection.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contentFactorSummary(message: Record<string, unknown>) {
  const content = message.content;
  const blocks = Array.isArray(content) ? content : [];
  const toolCallCount = blocks.filter((block) => {
    const item = isObject(block) ? block : {};
    return item.type === "toolCall" || item.type === "tool_use";
  }).length;
  return {
    role: typeof message.role === "string" ? message.role : "unknown",
    hasText: typeof message.text === "string" && message.text.trim().length > 0,
    contentBlockCount: blocks.length,
    toolCallCount,
    isToolResult: message.role === "tool" || message.role === "tool_result" || message.role === "toolResult",
  };
}

export class ChatLiveIngest {
  private subscribed = new Set<string>();
  private listening = false;
  private optimisticUsers = new Map<string, Array<{ id: string; text: string; runId?: string; idempotencyKey?: string; createdAtMs: number }>>();
  private readonly log = createLogger("chat-live");

  constructor(private readonly context: AppContext) {}

  async ensureSessionSubscribed(sessionKey: string) {
    if (!sessionKey.trim()) return;
    if (!this.listening) {
      this.context.gateway.onEvent((event) => this.handleGatewayEvent(event));
      this.listening = true;
      this.log.info("gateway.listener.attached", { listenerCount: 1 });
    }
    if (this.subscribed.has(sessionKey)) {
      this.log.info("session.subscribe.skip", { sessionKey, reason: "already-subscribed" });
      return;
    }
    this.log.info("session.subscribe.start", { sessionKey });
    try {
      await this.context.gateway.request("sessions.messages.subscribe", { key: sessionKey });
      this.subscribed.add(sessionKey);
      this.log.info("session.subscribe.end", { sessionKey, subscribedSessions: this.subscribed.size });
    } catch (error) {
      this.log.error("session.subscribe.fail", { sessionKey, ...errorMeta(error) });
      throw error;
    }
  }

  addOptimisticUser(sessionKey: string, message: { id: string; text: string; runId?: string; idempotencyKey?: string; createdAtMs?: number }) {
    const entries = this.optimisticUsers.get(sessionKey) ?? [];
    entries.push({ id: message.id, text: normalizeMessageText(message.text), runId: message.runId, idempotencyKey: message.idempotencyKey, createdAtMs: message.createdAtMs ?? Date.now() });
    this.optimisticUsers.set(sessionKey, entries.slice(-50));
    this.log.info("optimistic.user.add", { sessionKey, messageId: message.id, pendingOptimistic: this.optimisticUsers.get(sessionKey)?.length ?? 0 });
  }

  diagnostics() {
    return {
      subscribedSessions: [...this.subscribed],
      listening: this.listening,
      optimisticUserSessions: this.optimisticUsers.size,
    };
  }

  private handleGatewayEvent(event: GatewayEvent) {
    this.log.info("gateway.event", { event: event.event, hasPayload: isObject(event.payload) });
    if (event.event === "session.message") {
      this.handleSessionMessage(event.payload);
      return;
    }
    if (event.event === "sessions.changed") {
      this.handleSessionsChanged(event.payload);
      return;
    }
    if (event.event === "session.tool") {
      this.handleSessionTool(event.payload);
      return;
    }
    if (event.event === "chat" || event.event === "chat.delta" || event.event === "chat.final") {
      this.handleChatEvent(event.payload);
    }
  }

  private handleSessionMessage(payload: unknown) {
    if (!isObject(payload)) return;
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
    const message = isObject(payload.message) ? (payload.message as OpenClawMessage) : null;
    if (!sessionKey || !message) return;
    const receivedAtMs = Date.now();
    const optimistic = this.takeMatchingOptimisticUser(sessionKey, message);
    const optimisticId = optimistic?.id ?? null;
    this.log.info("message.factor.received", { sessionKey, ...contentFactorSummary(message as Record<string, unknown>), optimisticMatched: Boolean(optimisticId), runId: optimistic?.runId });
    const payloadSeq = typeof payload.messageSeq === "number" && Number.isFinite(payload.messageSeq) && payload.messageSeq > 0
      ? Math.floor(payload.messageSeq)
      : null;
    const normalized = normalizeHistoryMessages(sessionKey, [message], Date.now(), payloadSeq ?? this.context.messages.nextMessageSeq(sessionKey));
    const projectedMessage = normalized[0];
    if (!projectedMessage) return;
    const confirmed = optimisticId ? this.context.messages.confirmOptimisticUser(sessionKey, optimisticId, projectedMessage) : null;
    const projection = confirmed ? { upserted: 1, lastSeq: confirmed.openclawSeq } : this.context.messages.upsertMessages(normalized);
    const emittedMessage = confirmed?.data ?? message;
    const emittedSeq = confirmed?.openclawSeq ?? projectedMessage.openclawSeq;
    const associatedRun = this.associatedRunForMessage(sessionKey, message, optimistic?.runId);
    if (projectedMessage.role === "assistant" && associatedRun && !this.context.runs.hasRunningTools(sessionKey, associatedRun.runId)) {
      this.context.runs.updateRunStatus(associatedRun.runId, "done", { statusLabel: null });
      this.context.messages.upsertSession({
        sessionKey,
        sessionId: this.context.messages.getSession(sessionKey)?.sessionId ?? null,
        data: {
          ...this.objectData(this.context.messages.getSession(sessionKey)?.data),
          sessionKey,
          status: "done",
          statusLabel: null,
        },
      });
    }
    const runForPatch = associatedRun ? this.context.runs.getRun(associatedRun.runId) : null;
    this.log.info("message.persist", {
      sessionKey,
      ingestDurationMs: Date.now() - receivedAtMs,
      role: projectedMessage.role,
      messageId: projectedMessage.messageId,
      messageSeq: emittedSeq,
      upserted: projection.upserted,
      lastSeq: projection.lastSeq,
      optimisticMatched: Boolean(optimisticId),
      runId: runForPatch?.runId ?? optimistic?.runId,
      runStatus: runForPatch?.status,
    });
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: optimisticId ? "chat.message.confirmed" : "chat.message.upsert",
      payload: canonicalPatchPayload({
        sessionKey,
        semanticType: optimisticId ? "chat.user.confirmed" : projectedMessage.role === "assistant" ? "chat.assistant.final" : "chat.message.upsert",
        run: runForPatch,
        messageId: confirmed?.messageId ?? projectedMessage.messageId,
        payload: {
          sessionKey,
          message: emittedMessage,
          ...(optimisticId ? { optimisticId, gatewayMessageId: projectedMessage.messageId } : {}),
          ...(runForPatch?.runId ? { runId: runForPatch.runId } : optimistic?.runId ? { runId: optimistic.runId } : {}),
          messageSeq: emittedSeq,
          lastSeq: projection.lastSeq,
        },
      }),
    });
    this.context.patchBus.broadcast({
      cursor: patch.cursor,
      type: patch.eventType,
      sessionKey: patch.sessionKey,
      payload: patch.payload,
      createdAtMs: patch.createdAtMs,
    });
    this.log.info("patch.broadcast", { sessionKey, type: patch.eventType, cursor: patch.cursor, ingestDurationMs: Date.now() - receivedAtMs });
  }

  private associatedRunForMessage(sessionKey: string, message: OpenClawMessage, optimisticRunId?: string | null) {
    const explicitRunId = this.readRunId(message);
    if (explicitRunId) {
      return this.context.runs.findRunByGatewayRunId(explicitRunId) ?? this.context.runs.getRun(explicitRunId) ?? this.context.runs.findLatestPendingRun(sessionKey);
    }
    if (optimisticRunId) return this.context.runs.getRun(optimisticRunId) ?? this.context.runs.findLatestPendingRun(sessionKey);
    if (message.role === "assistant") return this.context.runs.findLatestPendingRun(sessionKey);
    return null;
  }

  private readRunId(message: OpenClawMessage): string | null {
    const openclaw = isObject(message.__openclaw) ? message.__openclaw as Record<string, unknown> : {};
    const runId = openclaw.runId ?? message.runId ?? message.gatewayRunId;
    return typeof runId === "string" && runId.trim() ? runId.trim() : null;
  }

  private objectData(value: unknown): Record<string, unknown> {
    return isObject(value) ? value : {};
  }

  private takeMatchingOptimisticUser(sessionKey: string, message: OpenClawMessage): { id: string; runId?: string; idempotencyKey?: string } | null {
    if (message.role !== "user") return null;
    const entries = this.optimisticUsers.get(sessionKey);
    if (!entries?.length) return null;
    const now = Date.now();
    const messageOpenClaw = isObject(message.__openclaw) ? message.__openclaw as Record<string, unknown> : {};
    const clientMessageId = typeof messageOpenClaw.clientMessageId === "string" ? messageOpenClaw.clientMessageId : typeof message.clientMessageId === "string" ? message.clientMessageId : null;
    const idempotencyKey = typeof messageOpenClaw.idempotencyKey === "string" ? messageOpenClaw.idempotencyKey : typeof message.idempotencyKey === "string" ? message.idempotencyKey : null;
    const text = textFromMessage(message);
    let index = clientMessageId ? entries.findIndex((entry) => entry.id === clientMessageId && messageTextMatchesSent(text, entry.text)) : -1;
    if (index < 0 && idempotencyKey) index = entries.findIndex((entry) => entry.idempotencyKey === idempotencyKey && messageTextMatchesSent(text, entry.text));
    if (index < 0) {
      index = text ? entries.findIndex((entry) => messageTextMatchesSent(text, entry.text) && now - entry.createdAtMs < 10 * 60 * 1000) : -1;
    }
    if (index < 0) {
      this.optimisticUsers.set(sessionKey, entries.filter((entry) => now - entry.createdAtMs < 10 * 60 * 1000));
      return null;
    }
    const [match] = entries.splice(index, 1);
    if (entries.length > 0) this.optimisticUsers.set(sessionKey, entries);
    else this.optimisticUsers.delete(sessionKey);
    return match ? { id: match.id, runId: match.runId, idempotencyKey: match.idempotencyKey } : null;
  }

  private handleSessionTool(payload: unknown) {
    if (!isObject(payload)) return;
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : typeof payload.key === "string" ? payload.key : null;
    if (!sessionKey) return;
    const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : typeof payload.id === "string" ? payload.id : null;
    if (!toolCallId) return;
    const gatewayRunId = typeof payload.runId === "string" ? payload.runId : null;
    const run = gatewayRunId ? this.context.runs.findRunByGatewayRunId(gatewayRunId) ?? this.context.runs.getRun(gatewayRunId) : this.context.runs.findLatestPendingRun(sessionKey);
    const rawPhase = typeof payload.phase === "string" ? payload.phase.toLowerCase() : typeof payload.status === "string" ? payload.status.toLowerCase() : "start";
    const phase = rawPhase === "error" || rawPhase === "failed" ? "error" : rawPhase === "result" || rawPhase === "done" || rawPhase === "success" ? "result" : rawPhase === "calling" ? "calling" : "start";
    const name = typeof payload.name === "string" ? payload.name : typeof payload.toolName === "string" ? payload.toolName : "unknown";
    const tool = this.context.runs.upsertToolCall({
      sessionKey,
      toolCallId,
      runId: run?.runId ?? gatewayRunId,
      messageId: typeof payload.messageId === "string" ? payload.messageId : null,
      name,
      phase,
      argsMeta: isObject(payload.args) ? { keys: Object.keys(payload.args).slice(0, 20) } : null,
      resultMeta: phase === "result" ? this.safeResultMeta(payload.result) : phase === "error" ? this.safeResultMeta(payload.error) : null,
    });
    if (run) {
      if (tool.status === "running") this.context.runs.updateRunStatus(run.runId, "tool_running", { statusLabel: name });
      else if (!this.context.runs.hasRunningTools(sessionKey, run.runId)) this.context.runs.updateRunStatus(run.runId, "thinking", { statusLabel: "Thinking" });
    }
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: phase === "error" ? "chat.tool.error" : phase === "result" ? "chat.tool.result" : "chat.tool.started",
      payload: canonicalPatchPayload({
        sessionKey,
        semanticType: phase === "error" ? "chat.tool.error" : phase === "result" ? "chat.tool.result" : "chat.tool.started",
        run: tool.runId ? this.context.runs.getRun(tool.runId) : run,
        tool,
        payload: { sessionKey, toolCall: tool },
      }),
    });
    this.context.patchBus.broadcast({ cursor: patch.cursor, type: patch.eventType, sessionKey: patch.sessionKey, payload: patch.payload, createdAtMs: patch.createdAtMs });
    this.log.info("tool.persist", { sessionKey, toolCallId, runId: tool.runId, phase: tool.phase, status: tool.status });
  }

  private handleChatEvent(payload: unknown) {
    if (!isObject(payload)) return;
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
    if (!sessionKey) return;
    const gatewayRunId = typeof payload.runId === "string" ? payload.runId : null;
    const run = gatewayRunId ? this.context.runs.findRunByGatewayRunId(gatewayRunId) ?? this.context.runs.getRun(gatewayRunId) : this.context.runs.findLatestPendingRun(sessionKey);
    if (!run) return;
    const status = typeof payload.status === "string" ? payload.status.toLowerCase() : typeof payload.phase === "string" ? payload.phase.toLowerCase() : null;
    if (status === "final" || status === "done" || status === "completed") {
      if (!this.context.runs.hasRunningTools(sessionKey, run.runId)) this.context.runs.updateRunStatus(run.runId, "done", { statusLabel: null });
      return;
    }
    if (status === "error" || status === "failed") {
      this.context.runs.updateRunStatus(run.runId, "error", { statusLabel: typeof payload.error === "string" ? payload.error : "Run failed", error: payload.error ?? payload });
      return;
    }
    if (status === "streaming" || typeof payload.delta === "string") this.context.runs.updateRunStatus(run.runId, "streaming", { statusLabel: null });
  }

  private safeResultMeta(value: unknown) {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return { type: "string", length: value.length };
    if (Array.isArray(value)) return { type: "array", length: value.length };
    if (isObject(value)) return { type: "object", keys: Object.keys(value).slice(0, 20) };
    return { type: typeof value };
  }

  private handleSessionsChanged(payload: unknown) {
    if (!isObject(payload)) return;
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
    if (!sessionKey) return;
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    const status = typeof payload.status === "string" ? payload.status : null;
    this.context.messages.upsertSession({ sessionKey, sessionId, data: payload });
    this.log.info("session.persist", { sessionKey, sessionId, status });
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "session.upsert",
      payload,
    });
    this.context.patchBus.broadcast({
      cursor: patch.cursor,
      type: patch.eventType,
      sessionKey: patch.sessionKey,
      payload: patch.payload,
      createdAtMs: patch.createdAtMs,
    });
    this.log.info("patch.broadcast", { sessionKey, type: patch.eventType, cursor: patch.cursor, status });
  }
}
