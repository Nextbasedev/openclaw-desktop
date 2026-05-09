import type { AppContext } from "../../app.js";
import type { GatewayEvent } from "../gateway/client.js";
import { normalizeHistoryMessages } from "./message-normalizer.js";
import type { OpenClawMessage } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export class ChatLiveIngest {
  private subscribed = new Set<string>();
  private listening = false;

  constructor(private readonly context: AppContext) {}

  async ensureSessionSubscribed(sessionKey: string) {
    if (!sessionKey.trim()) return;
    if (!this.listening) {
      this.context.gateway.onEvent((event) => this.handleGatewayEvent(event));
      this.listening = true;
    }
    if (this.subscribed.has(sessionKey)) return;
    await this.context.gateway.request("sessions.messages.subscribe", { key: sessionKey });
    this.subscribed.add(sessionKey);
  }

  diagnostics() {
    return {
      subscribedSessions: [...this.subscribed],
      listening: this.listening,
    };
  }

  private handleGatewayEvent(event: GatewayEvent) {
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
    const normalized = normalizeHistoryMessages(sessionKey, [message]);
    const projection = this.context.messages.upsertMessages(normalized);
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: "chat.message.upsert",
      payload: {
        sessionKey,
        message,
        messageSeq: payload.messageSeq ?? message.__openclaw?.seq ?? projection.lastSeq,
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
  }

  private handleSessionsChanged(payload: unknown) {
    if (!isObject(payload)) return;
    const sessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : null;
    if (!sessionKey) return;
    this.context.messages.upsertSession({ sessionKey, sessionId: typeof payload.sessionId === "string" ? payload.sessionId : null, data: payload });
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
  }
}
