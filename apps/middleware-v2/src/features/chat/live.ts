import type { AppContext } from "../../app.js";
import type { GatewayEvent } from "../gateway/client.js";
import { normalizeHistoryMessages } from "./message-normalizer.js";
import type { OpenClawMessage } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: string) {
  return value
    .replace(/^Sender \(untrusted metadata\):\s*```(?:json)?\s*[\s\S]*?```\s*/i, "")
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?\s+(?:UTC|GMT[+-]\d{1,2}:?\d{2})\]\s*/i, "")
    .replace(/^\[Attached images?:[^\]]+\]\s*/gim, "")
    .replace(/^\[Attached audio(?: file)?:[^\]]+\]\s*/gim, "")
    .replace(/^\[Attached file:[^\]]+\]\s*/gim, "")
    .replace(/<attached-file\b[\s\S]*?<\/attached-file>/gi, "")
    .trim()
    .replace(/\s+/g, " ");
}

export class ChatLiveIngest {
  private subscribed = new Set<string>();
  private listening = false;
  private optimisticUsers = new Map<string, Array<{ id: string; text: string; createdAtMs: number }>>();

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

  addOptimisticUser(sessionKey: string, message: { id: string; text: string; createdAtMs?: number }) {
    const entries = this.optimisticUsers.get(sessionKey) ?? [];
    entries.push({ id: message.id, text: normalizeText(message.text), createdAtMs: message.createdAtMs ?? Date.now() });
    this.optimisticUsers.set(sessionKey, entries.slice(-50));
  }

  diagnostics() {
    return {
      subscribedSessions: [...this.subscribed],
      listening: this.listening,
      optimisticUserSessions: this.optimisticUsers.size,
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
    const optimisticId = this.takeMatchingOptimisticUser(sessionKey, message);
    const payloadSeq = typeof payload.messageSeq === "number" && Number.isFinite(payload.messageSeq) && payload.messageSeq > 0
      ? Math.floor(payload.messageSeq)
      : null;
    const normalized = normalizeHistoryMessages(sessionKey, [message], Date.now(), payloadSeq ?? this.context.messages.nextMessageSeq(sessionKey));
    const projection = this.context.messages.upsertMessages(normalized);
    if (optimisticId) this.context.messages.deleteMessageById(sessionKey, optimisticId);
    const patch = this.context.messages.appendProjectionEvent({
      sessionKey,
      eventType: optimisticId ? "chat.message.confirmed" : "chat.message.upsert",
      payload: {
        sessionKey,
        message,
        ...(optimisticId ? { optimisticId } : {}),
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

  private takeMatchingOptimisticUser(sessionKey: string, message: OpenClawMessage): string | null {
    if (message.role !== "user") return null;
    const text = normalizeText(typeof message.text === "string" ? message.text : "");
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
