import type { AppContext } from "../../app.js";
import { createLogger, errorMeta } from "../../lib/logger.js";
import type { GatewayEvent } from "../gateway/client.js";
import { normalizeHistoryMessages, normalizeMessageText, textFromMessage } from "./message-normalizer.js";
import type { OpenClawMessage } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class ChatLiveIngest {
  private subscribed = new Set<string>();
  private listening = false;
  private optimisticUsers = new Map<string, Array<{ id: string; text: string; createdAtMs: number }>>();
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

  addOptimisticUser(sessionKey: string, message: { id: string; text: string; createdAtMs?: number }) {
    const entries = this.optimisticUsers.get(sessionKey) ?? [];
    entries.push({ id: message.id, text: normalizeMessageText(message.text), createdAtMs: message.createdAtMs ?? Date.now() });
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
    this.log.info("gateway.event", { event: event.event });
    if (event.event === "session.message") {
      this.handleSessionMessage(event.payload);
      return;
    }
    if (event.event === "sessions.changed") {
      this.handleSessionsChanged(event.payload);
    }
  }

  private handleSessionMessage(payload: unknown) {
    if (!isObject(payload)) return;
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
    const message = isObject(payload.message) ? (payload.message as OpenClawMessage) : null;
    if (!sessionKey || !message) return;
    const optimisticId = this.takeMatchingOptimisticUser(sessionKey, message);
    const payloadSeq = typeof payload.messageSeq === "number" && Number.isFinite(payload.messageSeq) && payload.messageSeq > 0
      ? Math.floor(payload.messageSeq)
      : null;
    const normalized = normalizeHistoryMessages(sessionKey, [message], Date.now(), payloadSeq ?? this.context.messages.nextMessageSeq(sessionKey));
    const projectedMessage = normalized[0];
    if (!projectedMessage) return;
    const projection = this.context.messages.upsertMessages(normalized);
    this.log.info("message.persist", {
      sessionKey,
      role: projectedMessage.role,
      messageId: projectedMessage.messageId,
      messageSeq: projectedMessage.openclawSeq,
      upserted: projection.upserted,
      lastSeq: projection.lastSeq,
      optimisticMatched: Boolean(optimisticId),
    });
    if (optimisticId) {
      const deleted = this.context.messages.deleteMessageById(sessionKey, optimisticId);
      this.log.info("optimistic.user.confirm", { sessionKey, optimisticId, deleted });
    }
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: optimisticId ? "chat.message.confirmed" : "chat.message.upsert",
      payload: {
        sessionKey,
        message,
        ...(optimisticId ? { optimisticId } : {}),
        messageSeq: projectedMessage.openclawSeq,
        lastSeq: projection.lastSeq,
      },
    });
    this.context.patchBus.broadcast({
      cursor: patch.cursor,
      type: patch.eventType,
      sessionKey: patch.sessionKey,
      payload: patch.payload,
      createdAtMs: patch.createdAtMs,
    });
    this.log.info("patch.broadcast", { sessionKey, type: patch.eventType, cursor: patch.cursor });
  }

  private takeMatchingOptimisticUser(sessionKey: string, message: OpenClawMessage): string | null {
    if (message.role !== "user") return null;
    const text = normalizeMessageText(textFromMessage(message));
    if (!text) return null;
    const entries = this.optimisticUsers.get(sessionKey);
    if (!entries?.length) return null;
    const now = Date.now();
    const index = entries.findIndex((entry) => entry.text === text && now - entry.createdAtMs < 10 * 60 * 1000);
    if (index < 0) {
      this.optimisticUsers.set(sessionKey, entries.filter((entry) => now - entry.createdAtMs < 10 * 60 * 1000));
      return null;
    }
    const [match] = entries.splice(index, 1);
    if (entries.length > 0) this.optimisticUsers.set(sessionKey, entries);
    else this.optimisticUsers.delete(sessionKey);
    return match?.id ?? null;
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
