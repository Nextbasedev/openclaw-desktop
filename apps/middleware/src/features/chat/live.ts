import type { AppContext } from "../../app.js";
import { createLogger, errorMeta } from "../../lib/logger.js";
import type { GatewayEvent } from "../gateway/client.js";
import { messageTextMatchesSent, normalizeHistoryMessages, normalizeMessageText, textFromMessage } from "./message-normalizer.js";
import { classifyGatewayMessageSemanticType, projectGatewayMessage, readToolCallId, readToolName } from "./gateway-event-projector.js";
import type { OpenClawMessage } from "./types.js";
import type { ProjectedRun } from "./repo.runs.js";
import { canonicalPatchPayload } from "./projection.js";

type ChatHistoryResponse = {
  sessionKey?: string;
  sessionId?: string;
  messages?: unknown[];
  status?: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function contentFactorSummary(message: Record<string, unknown>) {
  const content = message.content;
  const blocks = Array.isArray(content) ? content : [];
  const toolCallCount = blocks.filter((block) => {
    const item = isObject(block) ? block : {};
    return item.type === "toolCall" || item.type === "tool_use" || item.type === "tool_call" || item.type === "toolUse";
  }).length;
  return {
    role: typeof message.role === "string" ? message.role : "unknown",
    hasText: typeof message.text === "string" && message.text.trim().length > 0,
    contentBlockCount: blocks.length,
    toolCallCount,
    isToolResult: message.role === "tool" || message.role === "tool_result" || message.role === "toolResult",
  };
}

function extractChildSessionKey(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        return extractChildSessionKey(JSON.parse(trimmed) as unknown, depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractChildSessionKey(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  if (typeof value.childSessionKey === "string" && value.childSessionKey.trim()) return value.childSessionKey.trim();
  for (const child of Object.values(value)) {
    const found = extractChildSessionKey(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function isSubagentSessionKey(sessionKey: string) {
  return sessionKey.includes(":subagent:");
}

function textFromLiveValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const text = value.map(textFromLiveValue).filter((item): item is string => Boolean(item)).join("");
    return text || null;
  }
  if (!isObject(value)) return null;
  return firstString(
    value.text,
    value.delta,
    value.content,
    value.message,
    value.output,
    value.response,
    value.value,
  ) ?? textFromLiveValue(value.data) ?? textFromLiveValue(value.chunk);
}

export class ChatLiveIngest {
  private subscribed = new Set<string>();
  private listening = false;
  private optimisticUsers = new Map<string, Array<{ id: string; text: string; runId?: string; idempotencyKey?: string; createdAtMs: number }>>();
  private liveAssistantText = new Map<string, string>();
  private historyBackfillTimers = new Map<string, NodeJS.Timeout>();
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

  async ensureRecentSessionsSubscribed(limit = 100) {
    const sessionKeys = this.context.messages.listRecentSessionKeys(limit);
    if (sessionKeys.length === 0) return { attempted: 0, subscribed: this.subscribed.size };
    this.log.info("recent-sessions.subscribe.start", { sessionCount: sessionKeys.length, alreadySubscribed: this.subscribed.size });
    let attempted = 0;
    for (const sessionKey of sessionKeys) {
      attempted += 1;
      try {
        await this.ensureSessionSubscribed(sessionKey);
      } catch (error) {
        this.log.warn("recent-sessions.subscribe.session-fail", { sessionKey, ...errorMeta(error) });
      }
    }
    this.log.info("recent-sessions.subscribe.end", { attempted, subscribed: this.subscribed.size });
    return { attempted, subscribed: this.subscribed.size };
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
      return;
    }
    if (event.event === "agent") {
      this.handleAgentEvent(event.payload);
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
    if (!confirmed && projection.upserted === 0) {
      this.log.info("message.replay.noop", { sessionKey, role: projectedMessage.role, messageId: projectedMessage.messageId, messageSeq: projectedMessage.openclawSeq });
      return;
    }
    const emittedMessage = confirmed?.data ?? message;
    const emittedSeq = confirmed?.openclawSeq ?? projectedMessage.openclawSeq;
    const activityAt = new Date(projectedMessage.updatedAtMs).toISOString();
    this.context.compat?.touchChatActivity({
      sessionKey,
      at: activityAt,
      lastMessageText: textFromMessage(message),
    });
    const associatedRun = this.associatedRunForMessage(sessionKey, message, optimistic?.runId);
    const gatewayProjection = projectGatewayMessage(message);
    this.projectToolsFromMessage(sessionKey, message, associatedRun, gatewayProjection);
    const assistantHasFinalText = gatewayProjection.assistantHasFinalText;
    if (assistantHasFinalText && associatedRun) {
      this.scheduleHistoryBackfill(sessionKey, associatedRun.runId, "assistant_final_after_tool_calls");
    } else if (assistantHasFinalText && isSubagentSessionKey(sessionKey)) {
      this.scheduleHistoryBackfill(sessionKey, null, "subagent_assistant_final_after_tool_calls");
    }
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
          lastActiveAt: activityAt,
          lastMessageAt: activityAt,
          lastMessageText: textFromMessage(message),
        },
        updatedAtMs: projectedMessage.updatedAtMs,
      });
    }
    if (projectedMessage.role === "assistant" && associatedRun) {
      this.liveAssistantText.delete(associatedRun.runId);
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
    const emitMessagePatch = () => {
      if (!gatewayProjection.emitMessagePatch && !optimisticId) {
        this.log.info("message.patch.skip_tool_result", { sessionKey, role: projectedMessage.role, messageId: projectedMessage.messageId, messageSeq: emittedSeq });
        return;
      }
      const patch = this.context.messages.appendProjectionEvent({
        sessionKey,
        eventType: optimisticId ? "chat.message.confirmed" : "chat.message.upsert",
        payload: canonicalPatchPayload({
          sessionKey,
          semanticType: optimisticId
            ? "chat.user.confirmed"
            : gatewayProjection.semanticType,
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
      this.log.info("patch.broadcast", { sessionKey, type: patch.eventType, cursor: patch.cursor, ingestDurationMs: Date.now() - receivedAtMs, delayed: false });
    };
    emitMessagePatch();
  }

  private associatedRunForMessage(sessionKey: string, message: OpenClawMessage, optimisticRunId?: string | null) {
    const explicitRunId = this.readRunId(message);
    if (explicitRunId) {
      return this.context.runs.findRunByGatewayRunId(explicitRunId) ?? this.context.runs.getRun(explicitRunId);
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
    const data = isObject(payload.data) ? payload.data : payload;
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : typeof payload.key === "string" ? payload.key : typeof data.sessionKey === "string" ? data.sessionKey : typeof data.key === "string" ? data.key : null;
    if (!sessionKey) return;
    const toolCallId = readToolCallId(data);
    if (!toolCallId) return;
    const gatewayRunId = typeof payload.runId === "string" ? payload.runId : typeof data.runId === "string" ? data.runId : null;
    const run = gatewayRunId ? this.context.runs.findRunByGatewayRunId(gatewayRunId) ?? this.context.runs.getRun(gatewayRunId) : this.context.runs.findLatestPendingRun(sessionKey);
    const rawPhase = typeof data.phase === "string" ? data.phase.toLowerCase() : typeof data.status === "string" ? data.status.toLowerCase() : "start";
    const phase = rawPhase === "error" || rawPhase === "failed"
      ? "error"
      : rawPhase === "result" || rawPhase === "done" || rawPhase === "success" || rawPhase === "end" || rawPhase === "completed"
        ? "result"
        : rawPhase === "update" || rawPhase === "delta" || rawPhase === "progress"
          ? "update"
          : rawPhase === "calling"
            ? "calling"
            : "start";
    const name = typeof data.name === "string" ? data.name : typeof data.toolName === "string" ? data.toolName : "unknown";
    // Important: a later tool start is not proof that the previous tool result
    // exists. Older middleware inferred success here, which produced fake
    // result-before-call ordering in Activity. Gateway's live `agent` item /
    // command_output stream and persisted chat.history toolResult messages are
    // the only sources that may advance tool output/result state.
    const liveResultValue = data.result ?? data.partialResult ?? data.output ?? data.content ?? data.message ?? data.details;
    const liveResultMeta = this.safeResultMeta(liveResultValue);
    const existingTool = this.context.runs.getToolCall(sessionKey, toolCallId);
    const isCompletionOnlyResult = phase === "result" && liveResultValue === undefined;
    const shouldMarkAwaitingResult = isCompletionOnlyResult && (!existingTool?.resultMeta || this.isAwaitingToolResultMeta(existingTool.resultMeta));
    const awaitingResultMeta = shouldMarkAwaitingResult ? this.awaitingToolResultMeta("gateway_stripped_live_result") : null;
    const tool = this.context.runs.upsertToolCall({
      sessionKey,
      toolCallId,
      runId: run?.runId ?? gatewayRunId,
      messageId: typeof payload.messageId === "string" ? payload.messageId : typeof data.messageId === "string" ? data.messageId : null,
      name,
      phase,
      argsMeta: isObject(data.args) ? data.args : null,
      resultMeta: phase === "error" ? this.safeResultMeta(data.error) : shouldMarkAwaitingResult ? awaitingResultMeta : liveResultMeta,
    });
    if ((phase === "start" || phase === "calling") && tool.status !== "running") {
      this.log.info("tool.replayed-start.skip-terminal", { sessionKey, toolCallId, requestedPhase: phase, existingPhase: tool.phase, status: tool.status });
      return;
    }
    if (tool.status === "running" && !tool.runId && !isSubagentSessionKey(sessionKey)) {
      this.log.warn("tool.detached-running-ignored", { sessionKey, toolCallId, phase, name, fallbackRunId: run?.runId ?? null });
      return;
    }
    if (tool.status === "running" && !tool.runId) {
      this.log.info("tool.detached-subagent-live", { sessionKey, toolCallId, phase, name });
    }
    const associatedRun = tool.runId ? this.context.runs.getRun(tool.runId) : null;
    if (associatedRun) {
      if (tool.status === "running") this.context.runs.updateRunStatus(associatedRun.runId, "tool_running", { statusLabel: name });
      else if (!this.context.runs.hasRunningTools(sessionKey, associatedRun.runId)) this.context.runs.updateRunStatus(associatedRun.runId, "thinking", { statusLabel: "Thinking" });
    }
    const patchRun = tool.runId ? this.context.runs.getRun(tool.runId) : null;
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: phase === "error" ? "chat.tool.error" : phase === "result" ? "chat.tool.result" : phase === "update" ? "chat.tool.update" : "chat.tool.started",
      payload: canonicalPatchPayload({
        sessionKey,
        semanticType: phase === "error" ? "chat.tool.error" : phase === "result" ? "chat.tool.result" : phase === "update" ? "chat.tool.update" : "chat.tool.started",
        run: patchRun,
        tool,
        payload: { sessionKey, phase, ...(liveResultValue !== undefined ? { output: liveResultValue, result: liveResultValue } : {}) },
      }),
    });
    this.context.patchBus.broadcast({ cursor: patch.cursor, type: patch.eventType, sessionKey: patch.sessionKey, payload: patch.payload, createdAtMs: patch.createdAtMs });
    this.log.info("tool.persist", { sessionKey, toolCallId, runId: tool.runId, phase: tool.phase, status: tool.status, awaitingResult: shouldMarkAwaitingResult });
    if (shouldMarkAwaitingResult) {
      this.scheduleHistoryBackfill(sessionKey, tool.runId ?? run?.runId ?? gatewayRunId, "gateway_stripped_live_tool_result");
    }
    if (tool.name === "sessions_spawn" && phase === "result") {
      const childSessionKey = extractChildSessionKey(tool.resultMeta) ?? extractChildSessionKey(liveResultMeta);
      if (childSessionKey && childSessionKey !== sessionKey) {
        void this.ensureSessionSubscribed(childSessionKey)
          .then(() => this.log.info("subagent.child.subscribe.ready", { parentSessionKey: sessionKey, childSessionKey, toolCallId }))
          .catch((error) => this.log.warn("subagent.child.subscribe.fail", { parentSessionKey: sessionKey, childSessionKey, toolCallId, ...errorMeta(error) }));
      }
    }
  }


  projectToolsFromMessage(sessionKey: string, message: OpenClawMessage, run: ProjectedRun | null, projection = projectGatewayMessage(message)) {
    const openclaw = isObject(message.__openclaw) ? message.__openclaw as Record<string, unknown> : {};
    const messageId = typeof openclaw.id === "string" ? openclaw.id : typeof message.id === "string" ? message.id : null;
    for (const event of projection.toolEvents) {
      const name = event.name ?? readToolName(message as unknown as Record<string, unknown>) ?? "unknown";
      this.handleSessionTool({
        sessionKey,
        runId: run?.gatewayRunId ?? run?.runId,
        messageId,
        toolCallId: event.toolCallId,
        name,
        phase: event.phase,
        args: event.args,
        result: event.result,
      });
    }
  }

  private handleChatEvent(payload: unknown) {
    if (!isObject(payload)) return;
    const data = isObject(payload.data) ? payload.data : isObject(payload.payload) ? payload.payload : payload;
    const sessionKey = firstString(payload.sessionKey, payload.key, data.sessionKey, data.key);
    if (!sessionKey) return;
    const gatewayRunId = firstString(payload.runId, data.runId, payload.id, data.id);
    const run = gatewayRunId ? this.context.runs.findRunByGatewayRunId(gatewayRunId) ?? this.context.runs.getRun(gatewayRunId) : this.context.runs.findLatestPendingRun(sessionKey);
    if (!run) return;
    const status = firstString(payload.status, data.status, payload.phase, data.phase)?.toLowerCase() ?? null;
    if (status === "final" || status === "done" || status === "completed") {
      // Wait for the canonical assistant session.message before broadcasting done.
      // Gateway can emit chat/final before the final persisted assistant message,
      // and an early done patch makes the UI drop the Thinking/streaming row.
      this.log.info("chat.event.final.defer", { sessionKey, runId: run.runId, gatewayRunId });
      return;
    }
    if (status === "error" || status === "failed") {
      this.liveAssistantText.delete(run.runId);
      const updated = this.context.runs.updateRunStatus(run.runId, "error", { statusLabel: typeof payload.error === "string" ? payload.error : "Run failed", error: payload.error ?? payload });
      if (updated) this.broadcastRunStatus(sessionKey, updated, "chat.run.error");
      return;
    }
    if (status === "streaming" || this.extractLiveAssistantText(data)) {
      const updated = this.context.runs.updateRunStatus(run.runId, "streaming", { statusLabel: "Streaming" });
      if (updated) this.broadcastRunStatus(sessionKey, updated, "chat.run.streaming");
      this.broadcastLiveAssistantText(sessionKey, updated ?? run, data);
    }
  }

  private handleAgentEvent(payload: unknown) {
    if (!isObject(payload)) return;
    const data = isObject(payload.data) ? payload.data : payload;
    const sessionKey = firstString(payload.sessionKey, data.sessionKey, payload.key, data.key);
    if (!sessionKey) return;
    const gatewayRunId = firstString(payload.runId, data.runId, payload.id, data.id);
    const run = gatewayRunId ? this.context.runs.findRunByGatewayRunId(gatewayRunId) ?? this.context.runs.getRun(gatewayRunId) : this.context.runs.findLatestPendingRun(sessionKey);
    if (payload.stream === "item" || payload.stream === "command_output") {
      this.projectAgentToolEvent(sessionKey, gatewayRunId, run?.runId ?? null, payload.stream, data);
      return;
    }
    if (payload.stream !== "thinking") return;
    if (!run) return;
    const text = textFromLiveValue(data.text);
    const delta = textFromLiveValue(data.delta) ?? text;
    if (!text && !delta) return;
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.reasoning.delta",
      payload: canonicalPatchPayload({
        sessionKey,
        semanticType: "chat.reasoning.delta",
        run,
        payload: {
          sessionKey,
          runId: run.runId,
          gatewayRunId: run.gatewayRunId,
          text,
          delta,
        },
      }),
    });
    this.context.patchBus.broadcast({ cursor: patch.cursor, type: patch.eventType, sessionKey: patch.sessionKey, payload: patch.payload, createdAtMs: patch.createdAtMs });
    this.log.info("reasoning.delta.broadcast", { sessionKey, runId: run.runId, cursor: patch.cursor, textLength: text?.length ?? 0, deltaLength: delta?.length ?? 0 });
  }

  private projectAgentToolEvent(sessionKey: string, gatewayRunId: string | null, runId: string | null, stream: unknown, data: Record<string, unknown>) {
    const toolCallId = readToolCallId(data);
    if (!toolCallId) return;
    const kind = typeof data.kind === "string" ? data.kind.toLowerCase() : null;
    const rawPhase = typeof data.phase === "string" ? data.phase.toLowerCase() : null;
    const name = firstString(data.name, data.toolName, data.tool) ?? "unknown";
    const output = data.output ?? data.progressText ?? data.summary;

    if (stream === "item" && kind && kind !== "tool" && kind !== "command") return;

    const phase = stream === "command_output"
      ? rawPhase === "end" || rawPhase === "done" || rawPhase === "completed" ? "result" : "update"
      : rawPhase === "end" || rawPhase === "done" || rawPhase === "completed" ? "result"
        : rawPhase === "update" ? "update"
          : "calling";

    const isCommandOutputEnd = stream === "command_output" && phase === "result";
    const isToolItemEndWithoutOutput = stream === "item" && phase === "result" && output === undefined;
    const resultMeta = output !== undefined
      ? this.safeResultMeta(output)
      : isToolItemEndWithoutOutput
        ? this.awaitingToolResultMeta("gateway_agent_item_end_pending_history_result")
        : null;

    this.handleSessionTool({
      sessionKey,
      runId: gatewayRunId ?? runId ?? undefined,
      toolCallId,
      name,
      phase,
      args: {
        ...(typeof data.title === "string" ? { title: data.title } : {}),
        ...(typeof data.meta === "string" ? { meta: data.meta } : {}),
        ...(typeof data.itemId === "string" ? { itemId: data.itemId } : {}),
        ...(kind ? { kind } : {}),
      },
      ...(resultMeta !== null ? { result: resultMeta } : {}),
    });

    if (isToolItemEndWithoutOutput || isCommandOutputEnd) {
      this.scheduleHistoryBackfill(sessionKey, runId, isCommandOutputEnd ? "gateway_agent_command_output_end" : "gateway_agent_item_end");
    }
  }

  private scheduleHistoryBackfill(sessionKey: string, runId: string | null, reason: string) {
    const existing = this.historyBackfillTimers.get(sessionKey);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.historyBackfillTimers.delete(sessionKey);
      void this.backfillHistory(sessionKey, runId, reason);
    }, 300);
    this.historyBackfillTimers.set(sessionKey, timer);
  }

  private async backfillHistory(sessionKey: string, runId: string | null, reason: string) {
    const startedAt = Date.now();
    try {
      const history = await this.context.gateway.request<ChatHistoryResponse>("chat.history", { sessionKey, limit: 200 });
      const messages = history.messages ?? [];
      if (!messages.length) return;
      const normalized = normalizeHistoryMessages(sessionKey, messages);
      const projection = this.context.messages.upsertMessages(normalized);
      const run = runId ? this.context.runs.getRun(runId) : this.context.runs.findLatestPendingRun(sessionKey) ?? this.context.runs.latestRun(sessionKey);
      for (const projected of projection.changedMessages) {
        const gatewayProjection = projectGatewayMessage(projected.data as OpenClawMessage);
        this.projectToolsFromMessage(sessionKey, projected.data as OpenClawMessage, run, gatewayProjection);
        if (!gatewayProjection.emitMessagePatch) {
          this.log.info("history.backfill.message-patch.skip_tool_result", { sessionKey, role: projected.role, messageId: projected.messageId, messageSeq: projected.openclawSeq });
          continue;
        }
        const semanticType = classifyGatewayMessageSemanticType(projected.role, projected.data as OpenClawMessage);
        const event = this.context.messages.appendProjectionEvent({
          sessionKey,
          eventType: "chat.message.upsert",
          payload: canonicalPatchPayload({
            sessionKey,
            semanticType,
            run,
            messageId: projected.messageId,
            payload: {
              sessionKey,
              message: projected.data,
              messageSeq: projected.openclawSeq,
              ...(run?.runId ? { runId: run.runId } : {}),
            },
          }),
        });
        this.context.patchBus.broadcast({ cursor: event.cursor, type: event.eventType, sessionKey: event.sessionKey, payload: event.payload, createdAtMs: event.createdAtMs });
      }
      this.log.info("history.backfill.end", { sessionKey, runId, reason, durationMs: Date.now() - startedAt, messages: messages.length, changedMessages: projection.changedMessages.length });
    } catch (error) {
      this.log.warn("history.backfill.fail", { sessionKey, runId, reason, ...errorMeta(error) });
    }
  }

  private extractLiveAssistantText(payload: Record<string, unknown>) {
    return textFromLiveValue(payload.delta) ??
      textFromLiveValue(payload.text) ??
      textFromLiveValue(payload.content) ??
      textFromLiveValue(payload.message) ??
      textFromLiveValue(payload.output) ??
      textFromLiveValue(payload.response) ??
      textFromLiveValue(payload.chunk);
  }

  private broadcastLiveAssistantText(sessionKey: string, run: ProjectedRun, payload: Record<string, unknown>) {
    const hasText = typeof payload.text === "string";
    const incoming = hasText ? payload.text as string : this.extractLiveAssistantText(payload);
    if (typeof incoming !== "string") return;
    const previous = this.liveAssistantText.get(run.runId) ?? "";
    const next = hasText ? incoming : `${previous}${incoming}`;
    if (!next || next === previous) return;
    this.liveAssistantText.set(run.runId, next);
    const messageId = `live:${run.runId}:assistant`;
    const projectedSeq = this.context.messages.nextMessageSeq(sessionKey);
    this.context.messages.upsertMessages([{
      sessionKey,
      openclawSeq: projectedSeq,
      messageId,
      role: "assistant",
      data: {
        id: messageId,
        role: "assistant",
        text: next,
        __openclaw: { id: messageId },
      },
      updatedAtMs: Date.now(),
    }]);
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.message.upsert",
      payload: canonicalPatchPayload({
        sessionKey,
        semanticType: "chat.assistant.delta",
        run,
        messageId,
        payload: {
          sessionKey,
          runId: run.runId,
          messageId,
          message: {
            id: messageId,
            role: "assistant",
            text: next,
            __openclaw: { id: messageId, runId: run.runId },
          },
        },
      }),
    });
    this.context.patchBus.broadcast({ cursor: patch.cursor, type: patch.eventType, sessionKey: patch.sessionKey, payload: patch.payload, createdAtMs: patch.createdAtMs });
    this.log.info("assistant.delta.broadcast", { sessionKey, runId: run.runId, cursor: patch.cursor, length: next.length });
  }

  private broadcastRunStatus(sessionKey: string, run: ProjectedRun, semanticType: string) {
    this.context.messages.upsertSession({
      sessionKey,
      sessionId: this.context.messages.getSession(sessionKey)?.sessionId ?? null,
      data: {
        ...this.objectData(this.context.messages.getSession(sessionKey)?.data),
        sessionKey,
        status: run.status === "done" ? "done" : run.status === "error" ? "error" : "running",
        statusLabel: run.statusLabel,
      },
    });
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.status",
      payload: canonicalPatchPayload({
        sessionKey,
        semanticType,
        run,
        payload: {
          sessionKey,
          runId: run.runId,
          status: run.status,
          statusLabel: run.statusLabel,
        },
      }),
    });
    this.context.patchBus.broadcast({ cursor: patch.cursor, type: patch.eventType, sessionKey: patch.sessionKey, payload: patch.payload, createdAtMs: patch.createdAtMs });
    this.log.info("status.broadcast", { sessionKey, type: patch.eventType, cursor: patch.cursor, status: run.status, statusLabel: run.statusLabel, semanticType });
  }

  private awaitingToolResultMeta(reason: string) {
    return {
      awaitingResult: true,
      completionInferred: true,
      source: "gateway_live_tool_result",
      reason,
    };
  }

  private isAwaitingToolResultMeta(value: unknown) {
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as Record<string, unknown>).awaitingResult === true);
  }

  private safeResultMeta(value: unknown, depth = 0): unknown {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          const parsed = JSON.parse(trimmed) as unknown;
          if (isObject(parsed) || Array.isArray(parsed)) return this.safeResultMeta(parsed, depth + 1);
        } catch {
          // Fall through to compact string metadata.
        }
      }
      return value.length > 20_000 ? `${value.slice(0, 20_000)}\n…[truncated ${value.length - 20_000} chars]` : value;
    }
    if (Array.isArray(value)) {
      if (depth >= 4) return { type: "array", length: value.length };
      return value.slice(0, 50).map((item) => this.safeResultMeta(item, depth + 1));
    }
    if (isObject(value)) {
      if (depth >= 4) return { type: "object", keys: Object.keys(value).slice(0, 20) };
      const result: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value).slice(0, 50)) {
        result[key] = this.safeResultMeta(child, depth + 1);
      }
      return result;
    }
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
    this.scheduleHistoryBackfill(sessionKey, null, "sessions.changed");
  }
}
