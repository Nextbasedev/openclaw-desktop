import type { OpenClawMessage, ProjectedMessage } from "./types.js";

export function readOpenClawSeq(message: OpenClawMessage, fallbackSeq: number): number {
  const seq = message.__openclaw?.seq;
  return typeof seq === "number" && Number.isFinite(seq) && seq > 0 ? Math.floor(seq) : fallbackSeq;
}

export function readOpenClawMessageId(message: OpenClawMessage): string | null {
  const id = message.__openclaw?.id ?? message.messageId ?? message.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function normalizeHistoryMessages(sessionKey: string, messages: unknown[], nowMs = Date.now(), firstFallbackSeq = 1): ProjectedMessage[] {
  return messages
    .filter((message): message is OpenClawMessage => Boolean(message) && typeof message === "object" && !Array.isArray(message))
    .map((message, index) => ({
      sessionKey,
      openclawSeq: readOpenClawSeq(message, firstFallbackSeq + index),
      messageId: readOpenClawMessageId(message),
      role: typeof message.role === "string" ? message.role : null,
      data: message,
      updatedAtMs: nowMs,
    }));
}
